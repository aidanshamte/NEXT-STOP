export function seedInstitutions(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO institutions VALUES (?,?,?)');
  insert.run('northbridge', 'Northbridge University', 'college');
  insert.run('lakeside', 'Lakeside Academy', 'school');
  const stop = db.prepare(
    'INSERT OR IGNORE INTO stops(id,institution_id,name,lat,lng,position) VALUES (?,?,?,?,?,?)',
  );
  for (const [org, lat, lng] of [
    ['northbridge', 41.16, -73.25],
    ['lakeside', 41.19, -73.22],
  ]) {
    ['Campus Center', 'Library Square', 'West Residence', 'Transit Hub'].forEach((name, i) =>
      stop.run(`${org}-${i}`, org, name, lat + i * 0.004, lng + i * 0.003, i),
    );
  }
}
