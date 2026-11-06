// Consistent online backups and verified restores for the SQLite database.
//   node server/backup.mjs backup  [--out ./data/backups] [--keep 14] [--upload]
//   node server/backup.mjs verify  --file <backup.db>
//   node server/backup.mjs restore --file <backup.db>   (stop the API first)
// --upload sends the file to BACKUP_BLOB_CONTAINER_URL using the Azure VM's managed
// identity, so no storage key is stored on the server.
import { backup, DatabaseSync } from 'node:sqlite';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  readFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { openDatabase, SCHEMA_VERSION } from './db.mjs';

export async function createBackup(dbPath, outDir, now = new Date()) {
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = join(outDir, `next-stop-${stamp}.db`);
  const source = new DatabaseSync(dbPath, { readOnly: true });
  try {
    await backup(source, file);
  } finally {
    source.close();
  }
  verifyBackup(file);
  return file;
}

export function verifyBackup(file) {
  if (!existsSync(file)) throw Error(`Backup not found: ${file}`);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const check = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(check)[0] !== 'ok') throw Error(`Integrity check failed for ${file}`);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION)
      throw Error(`Backup schema ${version} is newer than this server (${SCHEMA_VERSION}).`);
    const counts = {};
    for (const table of ['institutions', 'users', 'memberships', 'trips', 'requests'])
      counts[table] = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    return { version, counts };
  } finally {
    db.close();
  }
}

// Replaces the live database with a verified backup. The previous database is
// kept beside it (never deleted). The API must be stopped while this runs.
export function restoreBackup(file, dbPath, now = new Date()) {
  const summary = verifyBackup(file);
  const target = resolve(dbPath);
  if (existsSync(target)) {
    const keep = `${target}.pre-restore-${now.toISOString().replace(/[:.]/g, '-')}`;
    // Fold any WAL content into the current file before setting it aside.
    const live = new DatabaseSync(target);
    live.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    live.close();
    renameSync(target, keep);
    for (const suffix of ['-wal', '-shm']) if (existsSync(target + suffix)) rmSync(target + suffix);
    summary.previous = keep;
  }
  copyFileSync(file, target);
  // Apply any newer migrations so the restored file matches this release.
  openDatabase(target).close();
  return summary;
}

export function pruneBackups(outDir, keep) {
  const files = readdirSync(outDir)
    .filter((name) => /^next-stop-.*\.db$/.test(name))
    .map((name) => join(outDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const file of files.slice(keep)) rmSync(file);
  return files.slice(keep).length;
}

async function managedIdentityToken() {
  const response = await fetch(
    'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F',
    { headers: { Metadata: 'true' }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw Error(`Managed identity token request failed (${response.status}).`);
  return (await response.json()).access_token;
}

export async function uploadBackup(file, containerUrl, getToken = managedIdentityToken) {
  const url = new URL(containerUrl);
  if (url.protocol !== 'https:' || url.search)
    throw Error('Use an https container URL without a SAS/query.');
  const body = readFileSync(file);
  const response = await fetch(
    `${url.origin}${url.pathname.replace(/\/$/, '')}/${basename(file)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        'x-ms-version': '2021-08-06',
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': 'application/octet-stream',
      },
      body,
      signal: AbortSignal.timeout(120000),
    },
  );
  if (response.status !== 201) throw Error(`Blob upload failed (${response.status}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: process.env.BACKUP_DIR || './data/backups' },
      keep: { type: 'string', default: '14' },
      file: { type: 'string' },
      upload: { type: 'boolean', default: false },
    },
  });
  const dbPath = process.env.DATABASE_PATH || './data/next-stop.db';
  const command = positionals[0];
  try {
    if (command === 'backup') {
      const file = await createBackup(dbPath, values.out);
      const removed = pruneBackups(values.out, Math.max(1, Number(values.keep) || 14));
      console.log(
        `Backup written and verified: ${file}${removed ? ` (pruned ${removed} old)` : ''}`,
      );
      if (values.upload) {
        if (!process.env.BACKUP_BLOB_CONTAINER_URL)
          throw Error('Set BACKUP_BLOB_CONTAINER_URL to upload.');
        await uploadBackup(file, process.env.BACKUP_BLOB_CONTAINER_URL);
        console.log('Backup uploaded to Azure Blob Storage.');
      }
    } else if (command === 'verify') {
      console.log(JSON.stringify(verifyBackup(values.file)));
    } else if (command === 'restore') {
      if (!values.file) throw Error('Pass --file <backup.db>.');
      console.log(JSON.stringify(restoreBackup(values.file, dbPath)));
      console.log('Restore complete. Start the API and check /health.');
    } else {
      console.error(
        'Usage: node server/backup.mjs backup|verify|restore [--file f] [--out dir] [--upload]',
      );
      process.exit(2);
    }
  } catch (error) {
    console.error(`Backup command failed: ${error.message}`);
    process.exit(1);
  }
}
