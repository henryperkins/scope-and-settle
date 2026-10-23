# Google Cloud deployment

The entrant selected a tiny Google Cloud VM and `scope-and-settle.hperkins.com` on October 22, 2026. The application is deployed at [the selected HTTPS origin](https://scope-and-settle.hperkins.com); observed checks and outstanding validation are recorded below.

## Configuration

| Component | Configuration |
| --- | --- |
| Project / zone | `rising-woods-449718-v6` / `us-central1-a` |
| VM | `scope-and-settle`, one standard `e2-micro`, 1 GB RAM, Debian 12 |
| Storage | 20 GB standard boot disk; separate 10 GB standard data disk |
| Database mount | `/srv/scope-and-settle/data` on the host → `/var/data` in the container |
| Process model | One application container, UID 1000; systemd restart on failure and boot |
| Memory | App limited to 512 MB; tunnel limited to 128 MB; 1 GB host swap |
| HTTPS | Named Cloudflare Tunnel → loopback `127.0.0.1:8787` |
| Networking | Dedicated VPC/subnet; VM has no external IP; outbound Cloud NAT |
| Administration | OS Login over IAP; SSH ingress restricted to Google's IAP range |
| Payment environment | PayPal sandbox only |
| Secrets | Root-owned mode-0600 environment files under `/etc/scope-and-settle` |

The project's effective organization policies require OS Login and deny external VM addresses. This deployment complies with both. It does not relax either policy. No public HTTP/HTTPS ports are opened on the VM. Cloudflare serves HTTPS and the zone already redirects HTTP to HTTPS.

The existing zone-wide Cloud Connector sends most subdomains to an assets bucket. Its condition now excludes only this new hostname in addition to its previous exclusions. A hostname-specific configuration rule disables Rocket Loader so the app's ES modules execute normally. No other hostname's behavior was changed.

The [Google free tier](https://docs.cloud.google.com/free/docs/free-cloud-features#compute) covers eligible monthly `e2-micro` use in this region and 30 GB-months of standard persistent disk, subject to account-wide limits. The [published network rates](https://cloud.google.com/vpc/network-pricing) are $0.005/hour for the NAT public IPv4 address and $0.0014/hour for one VM using the gateway: about **$4.67 per 730-hour month**, before NAT data processing, excess egress, tax, or any compute/storage beyond the free allowance. This is an estimate, not a verified account invoice or a hard billing cap.

## Provision and deploy

`deploy/gcp/provision.ps1` documents the exact new-resource configuration. It intentionally fails on existing resource names; inspect and resume an incomplete provision instead of deleting resources or blindly rerunning it. All command defaults target the project/zone above.

1. Commit the reviewed release inputs and build/test the root Dockerfile with `--build-arg SOURCE_COMMIT=<full-commit> --build-arg PUBLIC_BASE_URL=https://scope-and-settle.hperkins.com`. The image serves a plugin kit pinned to that commit. Build from those exact committed files. Export it with `docker image save`, gzip it, and retain a SHA-256 checksum. Record the configuration digest in the archive's `manifest.json`, not just Docker Desktop's OCI descriptor ID: the VM's Docker reports the configuration digest as its image ID. Building locally avoids memory pressure on the tiny VM.
2. Run the provision script for a new deployment. The startup script installs Docker, formats only an unsigned data disk, mounts it by UUID, and creates a UID-1000 private data directory. Both disks are retained when the VM is deleted. A missing mount prevents the app unit from starting.
3. Configure a named, remotely managed Cloudflare Tunnel with the chosen hostname routed to `http://127.0.0.1:8787` and a final `http_status:404` catch-all. Create its proxied CNAME only after checking that the name is unused. Keep the token in an ignored, private `tunnel.env` as `TUNNEL_TOKEN=...`.
4. Build the backend locally. Run `node deploy/gcp/prepare-runtime.mjs scope-and-settle.hperkins.com` to prepare `output/gcp/private/runtime.env`. Protect that directory before writing credentials on Windows. The script refuses to overwrite an existing file and reads only the development AI ledger; it does not copy sessions or invoices.
5. Transfer the archive, both systemd units, `install-release.sh`, and the two private environment files to a mode-0700 staging directory over `gcloud compute scp --tunnel-through-iap`. Verify the archive checksum on the VM. Load it with `sudo docker load --input scope-and-settle.tar.gz`.
6. From that directory run `sudo bash install-release.sh scope-and-settle.hperkins.com sha256:THE_VERIFIED_IMAGE_ID`. The script checks the mounted data disk, installs private settings, starts the exact image, checks local health, and starts the pinned tunnel image. On updates it backs up the existing database first.
7. Remove the staged copies of secrets after installation. Keep the protected `/etc/scope-and-settle` copies. Do not print the environment files or a full `docker inspect` response.

The app image excludes local credentials and state. The container root filesystem is read-only, Linux capabilities are dropped, and only the persistent data mount and temporary directory are writable.

## Budget and provider setup

At migration, the local ledger held $0.837288 of conservative reservations/usage from failed attempts. The fresh hosted database is allocated **$24.16**, keeping the combined allocation below $25. No more live AI calls should run against the old local instance. Do not reset the hosted allowance by deploying a new empty data disk. These records are conservative application accounting, not actual provider billing.

After hosted health succeeds, run `node deploy/gcp/register-paypal-webhook.mjs https://scope-and-settle.hperkins.com`. It registers the callback on the existing sandbox REST app for the available `INVOICING.INVOICE.*` events (nine returned by the live API at setup), preserves unrelated subscriptions, and saves `PAYPAL_WEBHOOK_ID` into the private local runtime environment. It also creates and reads back a missing account-to-app webhook lookup, and refuses to replace a mapping owned by another app. Transfer the updated environment to the VM and restart only the app. Registration and HTTP 202 redelivery acceptance do not prove signed callback receipt. Check [PayPal's webhook API](https://developer.paypal.com/api/webhooks/v1) and [event names](https://developer.paypal.com/api/rest/webhooks/event-names/).

The generated Figma plugin must use this HTTPS origin. From `app` in PowerShell:

```powershell
$env:PUBLIC_BASE_URL = 'https://scope-and-settle.hperkins.com'
try { npm run build } finally { Remove-Item Env:PUBLIC_BASE_URL }
```

Import `app/plugin/dist/manifest.json` in Figma desktop. A native plugin run, real comment/frame input, live AI evaluation, actual sandbox checkout, and webhook delivery are separate acceptance checks.

## Operations

The judging release uses reviewed source `5a620f461bd7da89fc07377ef17709155b15ef1b` and runtime image `sha256:488466daad1b504a73498b4c336edb552a4aa0292a085c6be93cdab8610c72c8`. Its clean-source Linux build passed 49 tests. Hosted entry, expiry/renewal, independent reset, preserved Paid state and restart checks passed. [Judging verification](JUDGING-VERIFICATION-2026-10-23.md) records the ZIP checksum and exact provider results; [webhook delivery](PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md) remains separately unresolved. Later sections preserve historical deployment observations.

Connect using:

```powershell
gcloud compute ssh scope-and-settle --project=rising-woods-449718-v6 --zone=us-central1-a --tunnel-through-iap
```

On the VM:

```sh
sudo systemctl status scope-and-settle scope-and-settle-tunnel
sudo docker exec scope-and-settle node scripts/backup-data.mjs
sudo docker exec scope-and-settle node scripts/create-demo-link.mjs
```

The development link is written to `/srv/scope-and-settle/data/designer-link.txt`. Retrieve it privately; it grants a role and expires after one hour. For durable judging access, run `sudo docker exec scope-and-settle node scripts/create-judge-access.mjs`. It prints only the new entry ID, expiry and protected JSON path. Retrieve that private file securely; it contains the judging code and entry URL. Provisioning snapshots the current project. Revoke an entry and all its grants with `sudo docker exec scope-and-settle node scripts/revoke-judge-access.mjs ENTRY_ID`. See [JUDGING.md](../JUDGING.md).

Consistent backups are written under the same data disk. Download and integrity-check a private copy before release; a same-disk backup alone does not protect against disk deletion. Keep one backend process per database. Judge runs retain their frozen project snapshots. Reset revokes only its run, retains invoice tombstones and the shared AI ledger, and cannot orphan that run's active invoice operation.

For shutdown after judging, remove only this deployment's VM, NAT/router, reserved address, tunnel/DNS record, and dedicated network. Preserve or explicitly back up the retained disks before deleting them. Stopping the VM alone does not stop all disk and reserved-IP charges.

## Verification record

**Latest continuation, October 22 evening Chicago / October 23 UTC:** actual sandbox buyer checkout completed for the approved $250 invoice. PayPal reports PAID with $0 due; the client page and native Figma show Paid on revision 1, including after reload/reopening. Real signed webhook delivery remains unverified. See [the completed payment evidence](PAYMENT-LOOP-2026-10-22.md) and [Baseten verification](BASETEN-VERIFICATION-2026-10-23.md). The deployed image remains `sha256:7297d12148612f62f96740815ae41d33ed18239f514ca458ba2349308c9a9f65`; no application redeployment was needed for payment. The dated observations below remain historical.

Verified on October 22, 2026:

- Public `/health` returns HTTP 200 with `ok: true` and sandbox mode. Missing authorization receives 401 on project, comments and order APIs; an unsigned webhook also receives 401.
- A designer session cannot perform client approval. The backend resolves the mobile-checkout rate to $250 even if the request supplies a different amount.
- A submitted proposal, its role session, invoice ID and unchanged AI budget settings survived hosted application restarts and the webhook-parser redeployment on the mounted disk.
- A revision-bound demo client approved the manual synthetic proposal. The hosted backend created/published one sandbox invoice for $250 with email notifications disabled. Repeating approval reused the same invoice. Authoritative invoice retrieval reports payment due.
- A separate off-host consistent database backup and private browser/Figma invitations were retrieved. Provider credentials are root-owned mode 0600; the app runs as UID 1000 with a read-only root filesystem.
- Both services are active and enabled. The current app image is `sha256:501c50611f22b0b9eee474894be8648cbd1e78db610fef5f218ecdec22d418e7`; the changed backend modules have the same SHA-256 hashes locally and in the running container. All 26 automated tests passed on Windows and in the Linux image build.
- The nine invoice webhook events are subscribed. PayPal's API lists the actual CREATED and UNPAID events for the hosted invoice, and accepted both resend requests with HTTP 202 at 21:49 UTC. At the 21:52 UTC server check, no signed callback receipt had been recorded. Event existence and resend acceptance are not delivery/signature-verification proof. Sampled Cloudflare analytics showed only the expected unsigned test requests, with no matching security events; that does not establish where provider delivery is delayed.

The local Figma build targets the hosted origin. Native Figma execution, a real comment/frame, live AI evaluation and actual sandbox buyer payment remain outstanding. The hosted comment read succeeded but returned zero comments. Browser interaction verification is waiting for an Edge extension popup to be dismissed.
