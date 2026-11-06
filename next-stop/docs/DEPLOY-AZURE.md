# Deploy the NEXT STOP API to Azure

This puts the API on a public HTTPS address so installed phone apps work over any cellular or Wi-Fi connection, with no laptop, shared network or Expo server involved.

**Status:** the templates, scripts and workflows are in the repository and tested locally where possible (see VALIDATION.md). Nothing has been provisioned yet. Provisioning creates billable resources, so you run it after reviewing the costs below.

## What gets created and why

| Resource                                                      | Purpose                                                      | Estimated monthly cost (USD, pay-as-you-go, East US)                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Linux VM `Standard_B2ats_v2` (2 vCPU, 1 GiB), Ubuntu 24.04    | Runs the API + WebSocket server and Caddy                    | **$0** within the student 750 free hours/month (12 months, new customers). Otherwise about $7 |
| OS disk, Standard SSD 30 GiB                                  | Operating system                                             | about $2.40                                                                                   |
| Data disk, Standard SSD 8 GiB (separate)                      | SQLite database and local backups. Survives VM rebuilds      | about $0.60                                                                                   |
| Standard static public IPv4 + DNS name                        | Stable `https://<label>.<region>.cloudapp.azure.com` address | about $3.65                                                                                   |
| Storage account (Cool, LRS, Entra-only auth)                  | Daily backups (kept 35 days) and release packages (120 days) | under $0.10 at pilot size                                                                     |
| Metric alert + action group                                   | Email when CPU stays above 85%                               | about $0.10                                                                                   |
| Budget                                                        | Emails at 50%/80% actual and 100% forecast of $15            | free                                                                                          |
| Outbound data                                                 | API traffic                                                  | first 100 GB/month free; a pilot uses far less                                                |
| Azure Communication Services Email (optional, separate setup) | Verification and reset emails                                | about $0.00025 per email                                                                      |

**Expected total: about $7/month while the VM is free, about $14–16/month after.** These are estimates. Prices change and vary by region, so confirm them in the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) before deploying. The student offer page lists the free VM sizes ([Azure for Students](https://azure.microsoft.com/free/students)). It does not list disks or public IPs, so this plan assumes those are billed against your $100 credit. An Azure for Students subscription has no credit card attached: when the credit runs out, resources are disabled rather than charged.

### Why one VM with SQLite, not App Service or PostgreSQL (yet)

- The server keeps realtime subscriptions in memory, so it must run as **exactly one instance**. A single VM makes that explicit.
- SQLite is reliable on a real attached disk. Microsoft advises against SQLite on App Service/Azure Files network storage because file locking is unreliable there ([App Service storage guidance](https://learn.microsoft.com/azure/app-service/configure-connect-to-azure-storage)). The data disk here is a normal block device.
- Keeping SQLite reuses the tested data layer and costs less. All writes run in one Node process, so concurrent pickup and capacity updates are serialized without races.
- **When to move on:** if you need more than one server instance, zero-downtime deploys, or managed point-in-time restore, migrate to Azure Database for PostgreSQL Flexible Server (B1MS is free for 12 months on eligible accounts) and add a shared event channel (for example, PostgreSQL LISTEN/NOTIFY). That requires rewriting the data layer as asynchronous code, and the migration must copy existing accounts. It is recorded in ROADMAP.md.

### Known limits of this design

- A deploy restarts the process: connected apps reconnect within seconds and resynchronize (tested behavior). Expect a brief gap of live updates during each deploy.
- If the VM fails, service is down until it restarts or is rebuilt. The data disk and Blob backups preserve the data, but nothing fails over automatically.
- Ubuntu installs security updates automatically and may reboot at 08:30 UTC when one requires it.

## One-time setup

You need the Azure CLI on your computer. Install it from [Microsoft's install page](https://learn.microsoft.com/cli/azure/install-azure-cli-windows), then open a new terminal.

### 1. Sign in and check your subscription

```bash
az login
az account show --query "{name:name, id:id, state:state}"
# Student subscriptions often restrict regions. List the ones you may use:
az policy assignment list --query "[].{name:displayName, params:parameters}" -o jsonc
```

Pick an allowed region close to your users (for example `eastus`), and check that the VM size is offered there:

```bash
az vm list-skus -l eastus --size Standard_B2ats_v2 --query "[].{size:name, restrictions:restrictions}" -o table
```

If it is restricted, use `Standard_B1s` (also free-hour eligible) with `-p vmSize=Standard_B1s`.

### 2. Create an SSH key (if you don't have one)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/nextstop_azure
```

Keep the private key private. Only the `.pub` file goes into the parameters.

### 3. Fill in parameters

```bash
cd next-stop
cp deploy/azure/main.parameters.example.json deploy/azure/main.parameters.json   # gitignored
```

Edit `main.parameters.json`:

- `dnsLabel`: a unique lowercase name such as `nextstop-api-yourname`. Your API becomes `https://<dnsLabel>.<region>.cloudapp.azure.com`.
- `sshPublicKey`: the contents of `~/.ssh/nextstop_azure.pub`.
- `sshSourceAddress`: your current public IP plus `/32` (search "what is my IP"). SSH is closed to everyone else. Update it if your IP changes.
- `alertEmail`, `budgetStartDate` (first day of the current month), `monthlyBudget`.
- Leave `deployerPrincipalId` empty for now (see "GitHub deployment" below).

### 4. Review, then provision (this starts billing)

```bash
az group create -n nextstop-pilot -l eastus
az bicep build --file deploy/azure/main.bicep          # compile check
az deployment group what-if -g nextstop-pilot -f deploy/azure/main.bicep -p @deploy/azure/main.parameters.json
az deployment group create  -g nextstop-pilot -f deploy/azure/main.bicep -p @deploy/azure/main.parameters.json \
  --query properties.outputs
```

Save the outputs: `apiUrl`, `vmName`, `storageAccount`. If the budget resource fails on your subscription type, remove the `budget` block, redeploy, and watch spending under **Cost Management** in the portal instead.

The VM finishes its first-boot setup about 5 minutes later. Check it with:

```bash
ssh -i ~/.ssh/nextstop_azure nextstopadmin@<dnsLabel>.<region>.cloudapp.azure.com 'cloud-init status --wait; cat /var/log/next-stop-bootstrap.done'
```

### 5. Put secrets on the server (never in Git, never in chat)

Set up email first using [AUTH-SETUP.md](AUTH-SETUP.md). For an Azure-native sender, use Azure Communication Services Email with SMTP: create an Email Communication Service with an Azure-managed domain, connect it to a Communication Services resource, then [create SMTP credentials](https://learn.microsoft.com/azure/communication-services/quickstarts/email/send-email-smtp/smtp-authentication). The host is `smtp.azurecomm.net`, port 587, and the password is an Entra app client secret. New email resources start with low sending limits; request a higher quota before a large pilot.

Then, on the VM:

```bash
ssh -i ~/.ssh/nextstop_azure nextstopadmin@<host>
sudoedit /etc/next-stop/next-stop.env
```

Contents (fill in your real values in the editor; this file is readable only by root and the service):

```ini
SMTP_HOST=smtp.azurecomm.net
SMTP_PORT=587
SMTP_USER=<your SMTP username>
SMTP_PASSWORD=<client secret>
SMTP_FROM=DoNotReply@<your-managed-domain>.azurecomm.net
GOOGLE_WEB_CLIENT_ID=<web client id>
GOOGLE_CLIENT_IDS=<web id>,<ios id>,<android id>
# Only if you host the web app on another origin:
ALLOWED_ORIGINS=
```

These are server settings. Infrastructure values (domain, storage URLs) are already in `/etc/next-stop/deploy.env`.

### 6. First deployment (from your computer, over SSH)

```bash
cd next-stop
ID=manual-$(git rev-parse --short=12 HEAD)
bash deploy/package-release.sh "$ID"
scp -i ~/.ssh/nextstop_azure build/release/$ID.tgz build/release/$ID.tgz.sha256 nextstopadmin@<host>:/tmp/
ssh -i ~/.ssh/nextstop_azure nextstopadmin@<host> \
  "tar -xzf /tmp/$ID.tgz -C /tmp deploy/release.sh && sudo bash /tmp/deploy/release.sh $ID /tmp/$ID.tgz"
```

`release.sh` verifies the checksum, installs only the server's dependencies, backs up the database, switches to the new release and waits for `/health` to report it. If the release is not healthy, it puts the previous release back, and the previous data too if a schema migration ran. Then check from anywhere:

```bash
curl https://<dnsLabel>.<region>.cloudapp.azure.com/health
```

The first HTTPS request can take up to a minute while Caddy obtains the certificate.

### 7. Create your institution without printing a password

1. Build or open the app pointed at the hosted API (step 8), create the administrator's account normally, and verify the real email code.
2. Then grant that existing account administrator rights on a new institution:

```bash
ssh -i ~/.ssh/nextstop_azure nextstopadmin@<host>
cd /opt/next-stop/current
sudo -u nextstop env DATABASE_PATH=/var/lib/next-stop/next-stop.db \
  node server/setup.mjs --name "Your school or college" --email "admin@your-school.edu" --kind college
```

Because the account already exists, no password is generated or printed.

### 8. Point the phone apps at the hosted API

`preview` and `production` builds **refuse to build** unless `EXPO_PUBLIC_API_URL` is an `https://` origin. This value is public (it is compiled into the app), so it can live in EAS environment variables:

```bash
npx eas-cli@latest env:create --environment preview    --name EXPO_PUBLIC_API_URL --value https://<host> --visibility plaintext
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<host> --visibility plaintext
```

Then follow PHONE-INSTALL.md, "Hosted pilot build".

## GitHub deployment (optional, recommended after the first manual deploy)

`.github/workflows/deploy-api.yml` deploys on demand from the Actions tab. It runs the tests, uploads the release package to the private storage account, installs it with Azure **Run Command** (no SSH port opened to GitHub), and passes only when the **public** `/health` reports the new release id. It signs in to Azure with OpenID Connect, so no Azure password or key is stored in GitHub.

```bash
APP_ID=$(az ad app create --display-name nextstop-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:aidanshamte/NEXT-STOP:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'
SP_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
# Grant it access to this VM and storage only, by redeploying with its id:
az deployment group create -g nextstop-pilot -f deploy/azure/main.bicep -p @deploy/azure/main.parameters.json -p deployerPrincipalId=$SP_ID
```

If your university tenant blocks app registration, keep using the SSH deployment in step 6.

In GitHub, create an environment named `production` (Settings → Environments; adding yourself as a required reviewer is a good safeguard). Then add these **repository variables** (Settings → Secrets and variables → Actions → Variables). None of them are secrets:

| Variable                | Value                                     |
| ----------------------- | ----------------------------------------- |
| `AZURE_CLIENT_ID`       | `$APP_ID`                                 |
| `AZURE_TENANT_ID`       | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv`       |
| `AZURE_RESOURCE_GROUP`  | `nextstop-pilot`                          |
| `AZURE_VM_NAME`         | output `vmName`                           |
| `AZURE_STORAGE_ACCOUNT` | output `storageAccount`                   |
| `API_URL`               | output `apiUrl`                           |

Setting `API_URL` also turns on the hourly uptime workflow (about 720 Actions minutes a month on a private repository). GitHub emails you when a scheduled run fails.

## Operations

**Logs** (JSON lines, no tokens, IPs, bodies, queries or coordinates):

```bash
sudo journalctl -u next-stop -f
sudo journalctl -u next-stop --since "1 hour ago" | grep '"level":"error"'
```

**Backups:** `next-stop-backup.timer` runs daily at about 07:15 UTC. It makes a verified copy (integrity check) in `/var/lib/next-stop/backups/daily` (14 kept) and uploads it to the `backups` container (kept 35 days). Every deploy also makes a pre-deploy copy in `backups/pre-deploy`. Run one now and check the timer:

```bash
sudo systemctl start next-stop-backup && sudo journalctl -u next-stop-backup -n 5
systemctl list-timers next-stop-backup.timer
```

**Restore drill.** Do this once before the pilot, and record the result in VALIDATION.md:

```bash
sudo systemctl stop next-stop
sudo -u nextstop env DATABASE_PATH=/var/lib/next-stop/next-stop.db \
  node /opt/next-stop/current/server/backup.mjs restore --file /var/lib/next-stop/backups/daily/<file>.db
sudo systemctl start next-stop && curl -s localhost:4000/health
```

The replaced database is kept beside the original as `next-stop.db.pre-restore-<time>`; it is never deleted. To restore from Blob storage, first give yourself data access, then download the file and copy it to the VM:

```bash
az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Storage Blob Data Contributor" --scope "$(az storage account show -n <storage> --query id -o tsv)"
az storage blob download --auth-mode login --account-name <storage> -c backups -n <file>.db -f <file>.db
```

**Rollback:**

- From GitHub, run _Deploy API (Azure)_ with `release_id` set to an earlier 12-character commit id.
- On the VM, `sudo bash /opt/next-stop/current/deploy/rollback.sh` switches to the previous installed release. That is a code-only rollback; if a newer release changed the schema, restore that release's pre-deploy backup as shown in the script header.

**Costs:** check Cost Management → Cost analysis, filtered to resource group `nextstop-pilot`. To stop the VM's compute cost temporarily, run `az vm deallocate -g nextstop-pilot -n <vmName>`; disks and the IP still bill. To remove everything, run `az group delete -n nextstop-pilot` — **this deletes the database disk and the backups**.

**Custom domain (later):** the GitHub Student Developer Pack includes domain offers. Point an A record at the public IP, change `NEXT_STOP_DOMAIN` in `/etc/next-stop/deploy.env`, restart Caddy, then rebuild the apps with the new `EXPO_PUBLIC_API_URL`.
