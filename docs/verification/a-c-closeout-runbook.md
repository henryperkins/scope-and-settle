# A–C candidate qualification and promotion runbook

Use the [qualification record](agent-integrations-a-c-closeout-2026-10-24.md), [exact artifacts](a-c-closeout-artifacts-2026-10-25.json) and [gate register](a-c-closeout-gates-2026-10-25.json). A local pass, Git push, container pass, hosted pass and provider/native/human pass are distinct. This runbook prepares actions; it grants no new external authority.

## Candidate, packaging and Docker gate

Run only from the isolated `codex/agent-integrations-through-t16` checkout. The runtime implementation was tested at `cf2069f13b3ce3b10dc0903c8e7c35e44190e751` (575/575). The artifact record pins the later documentation-aware package source, ZIP/checksums and proposed origin. Keep the primary and other worktrees intact.

Once the local Docker engine responds, export the exact recorded artifact-source commit into a new disposable directory and build that context. Read the record from the documentation checkout before exporting; the artifact-source commit intentionally precedes its own checksum record. These are prepared commands, not executed container proof:

```powershell
$candidate = Get-Content docs/verification/a-c-closeout-artifacts-2026-10-25.json -Raw | ConvertFrom-Json
$candidateSha = $candidate.artifactSourceCommit
$candidateOrigin = $candidate.publicUrl
$candidateTag = 'scope-and-settle:ac-closeout-' + $candidateSha.Substring(0,12)
$candidateExport = Join-Path ([IO.Path]::GetTempPath()) ('scope-settle-candidate-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $candidateExport | Out-Null
$candidateTar = Join-Path $candidateExport 'source.tar'
$candidateSource = Join-Path $candidateExport 'source'
New-Item -ItemType Directory -Path $candidateSource | Out-Null
git -c core.autocrlf=false archive --format=tar --output=$candidateTar $candidateSha
if ($LASTEXITCODE -ne 0) { throw 'Candidate source export failed' }
tar -xf $candidateTar -C $candidateSource
if ($LASTEXITCODE -ne 0) { throw 'Candidate source extraction failed' }
$originalFreeze = Get-Content (Join-Path $candidateSource 'docs/verification/scope-evaluation-contract.json') -Raw | ConvertFrom-Json
$generationEntry = $originalFreeze.source | Where-Object path -EQ 'app/src/backend/assessment.ts'
$generationHash = (Get-FileHash (Join-Path $candidateSource $generationEntry.path) -Algorithm SHA256).Hash.ToLowerInvariant()
if ($generationHash -ne $generationEntry.sha256) { throw 'Archived generation source differs from its original freeze' }
docker build --build-arg "SOURCE_COMMIT=$candidateSha" --build-arg "PUBLIC_BASE_URL=$candidateOrigin" --tag $candidateTag $candidateSource
if ($LASTEXITCODE -ne 0) { throw 'Candidate Docker build failed' }
$env:SOURCE_COMMIT = $candidateSha
$env:PUBLIC_BASE_URL = $candidateOrigin
Push-Location (Join-Path $candidateSource 'app')
try { node scripts/check-container.mjs $candidateTag }
finally { Pop-Location }
```

The recorded host plugin was built on Windows. On this workstation, plain `git archive` applies `core.autocrlf` and exports CRLF text, including the generation source whose historical freeze requires LF. The command-local `-c core.autocrlf=false` above preserves those repository bytes without changing Git configuration or the source. Keep the original Windows archive/checksums as historical evidence. Compare the Docker-built ZIP and each `SOURCE.json` checksum with the host artifact. Different bytes require a separately recorded artifact identity and affected checks before qualification; do not claim cross-platform byte reproducibility from the host package.

The Docker build must run the entire suite with Git and the four exact public evaluation inputs. Do not skip tests or broaden `.dockerignore` to private material. Smoke must prove health, anonymous 401, disabled MCP 404, non-root/production-only runtime, canonical operation reuse, cross-run 403 and session/order/100,000-micro-USD synthetic ledger persistence after container replacement. Git, test files and the four evaluation inputs must be absent from runtime. Record both the image ID and archive configuration digest, full source commit, origin, schema and plugin checksum. Preserve the task-specific image and logs; cleanup may remove only the runner's own uniquely named containers/volume.

## Isolated qualification deployment — separate authorization

Proposed origin: `https://scope-and-settle-qualification.hperkins.com`. First obtain the exact target/resource and account authority after reviewing the candidate artifacts and Docker result. It is not currently provisioned or verified. The existing production origin may be used only if explicitly approved as the qualification target; that choice requires matching origin bytes and repeated affected access checks.

Prepare a separately named service/container, private synthetic data directory/volume, loopback binding and scoped access. Do not run the existing provision/install script blindly: its defaults target the production VM/service/data. Reuse the established hardening (UID 1000, read-only root, dropped capabilities, bounded memory/logs) and one application writer per database. Confirm memory capacity before adding a service to the small existing VM; no build on that VM is implied.

Initial flags: PayPal sandbox, `MCP_CONNECTOR_ENABLED=false`, `FIGMA_WEBHOOK_ENABLED=false`, `FIGMA_COMMENT_POSTING_ENABLED=false`, `AGENT_WORKER_DISABLED=true`, `JOB_WORKER_DISABLED=true`, and **`AI_BUDGET_USD=0`** for a new isolated synthetic qualification database. Configure provider secrets through the existing protected secret mechanism, never chat, source or reports. A fresh qualification database creates no additional AI allowance. Native paid assessment requires an explicitly audited allocation/accounting arrangement; the prepared paid evaluator uses the existing designated ledger, not this empty database.

After approved installation, record image/configuration digest, `/downloads/plugin.json` source and ZIP checksum, `/health`, origin allowlists and scoped access. Confirm HTTPS callback routing to this exact candidate before provider actions. The existing production PayPal subscription must not be redirected without explicit account authority. Enable only the flags needed for each authorized test, verify the actual peer/origin settings, and leave unverified capabilities disabled.

Rollback for isolated staging: stop only the candidate's separately named service; retain its data, logs and image; remove/revert only the specifically authorized new route and callback changes. Never reset or overwrite production data. An old hosted release or healthy redirect does not qualify the new routes.

## Existing-ledger paid evaluation — separate authorization

Prepared runtime contract: `docs/verification/scope-evaluation-contract-a-c-closeout-2026-10-25.json`. Existing designated ledger: `/var/data/scope-and-settle.db` inside the current hosted container, backed by `/srv/scope-and-settle/data/scope-and-settle.db`. The historical local ledger is not authorized for resumed spending.

This contract records the exact 125 Windows workspace source/build bytes. It is not automatically portable across newline conversion or a new build platform. The evaluator needs the complete matching source, scripts, generated files and frozen fixtures; the lean production image intentionally omits some of those inputs and cannot execute this command alone. Prepare a dedicated reviewed evaluation workspace/runtime before any ledger handoff. Run validation there first. If any source/build hash differs, preserve this contract, review the differences and freeze a separately named target contract from the same reviewed source and actual inference identity, with unchanged generation implementation and held-out labels. Repeat validation and use that new contract explicitly; never bypass hash checks or label the old Windows manifest as Linux verification.

1. Refresh the read-only history hash and all allocations immediately before execution. The October 25 audit is only a snapshot. A private reviewed allocation has the exact CLI fields `schemaVersion`, `reviewed`, `ledgerPath`, `historyHash`, `capMicroUsd`, `otherAllocatedMicroUsd`, `globalCapMicroUsd`; history drift invalidates it. Do not put that private operational file into Git.
2. Obtain paid-run authority and any separate candidate deployment/migration authority. The live service still uses its existing runtime; do not assume it contains the evaluator or schema 19. Take a consistent matching backup before an authorized runtime/schema transition. Preserve every charged/reserved row and uncertain attempt.
3. Stop and drain the server that owns this existing ledger. Confirm exclusive runtime ownership. Run only the reviewed candidate against that same ledger and budget configuration, without a second server/worker or a duplicate spend-capacity copy.
4. From the candidate's `app/`, with the reviewed allocation securely mounted at the named path:

```text
node scripts/evaluate-ai.mjs --fixtures ../fixtures/scope-held-out-cases.json --output-label a-c-closeout-live --contract ../docs/verification/scope-evaluation-contract-a-c-closeout-2026-10-25.json --live --ledger /var/data/scope-and-settle.db --allocation /run/private/a-c-closeout-allocation.json
```

5. Record all 34 scenario/43 expected-item denominators, new versus cached results, not-attempted/failed/uncertain cases, latency, known and conservative charges. Keep rejected cases visible. An interrupted run requires a newly audited allocation before `--resume`; do not redispatch unresolved work after a code change.
6. Review each conclusion/quote against frozen labels. Required proposed bar: zero false-billable included/ambiguous decisions, zero duplicate-proposal invariant failures, at least 90% recognition of clearly new work. No held-out tuning. Fill the prepared semantic worksheet and name the reviewer. Restore the intended service only after the CLI has drained and released ownership.

At the audited balance, the full conservative reservation is $22.727912 and leaves $1.296819. Recheck affordability and later judging needs before approval; actual results and charges remain unknown.

## Exact sandbox/native walkthrough — separate account authority

Prerequisites: reachable authorized candidate, verified image/source/ZIP/origin, intended Figma account/file/connector entitlement, sandbox buyer and merchant access, candidate callback routing, and approved existing AI accounting for any actual assessment. No fixture or old payment substitutes.

1. Start fresh scoped designer/client access and a new synthetic run. Record nonsecret run/order IDs, source/version and exact reviewed revision. Through the intended supported Figma client, prove actual MCP discovery, bounded assessment and canonical draft; the connector cannot approve, publish or invoice. Verify plugin-closed inbox/reply behavior and card refresh/reopen separately.
2. Explicitly approve a **$100 deposit / $150 delivery balance** schedule. Confirm one exact deposit invoice and no premature balance. Complete real sandbox buyer deposit checkout. Record signed callback receipt and verification, durable job processing and authoritative exact-invoice retrieval. Record manual refresh separately if used; checkout redirect or webhook event name alone is insufficient.
3. Start approved work and read the standard native draft back from the intended Figma file. Judge actual criteria and retain provenance. Request changes, create a replacement, and have the client accept that exact review revision/snapshot hash. Confirm only one $150 balance invoice becomes due.
4. **Before paying the balance**, record its actual due-trigger/known-issue timestamps. Earliest reminder eligibility is at least 24 actual hours after the later timestamp, also respecting shared manual/automatic cadence. An already-old candidate-compatible fully unpaid invoice is an option only with separate authorization. No backdating, simulated clock, shortened cadence, extended consent or reset count is allowed.
5. Keep only the reminder gate `pending_eligibility` while waiting; enter the real earliest eligible timestamp once it exists. Continue unrelated checks. After eligibility, freshly preview/confirm or renew the exact reminder policy under renewable designer access whose parent remains valid at dispatch. Confirm invoice/recipient/merchant, policy version, expiry and prior automatic count. Record actual dispatch/provider acknowledgement times. An uncertain send permits read-only review, never automatic replay; acknowledgement does not prove recipient delivery.
6. Complete actual balance checkout, verify signed-event reconciliation and exact paid amounts, then restart/reopen under the same paid revision. Record the two invoice IDs, approval/acceptance/snapshot hashes and immutable history. Keep refunds/disputes unverified unless actual eligible resources are separately authorized (T21).

## Independent review and designer trials

Prepare the exact image-containing packet with authenticated originals. Give a separate authorized human reviewer the packet and a private scoped access path. Their checklist covers approved scope/version, provided versus verified identity, source quotations, replacement/acceptance hash, all PNG/JSON/HTML digest bytes, exact invoice associations, timestamps and external/refund qualifications. Record reviewer identity, verdict, discrepancies and artifact hash. The implementing main session cannot supply this independent verdict.

Observe 2–3 real designers doing the full task. Record per-participant start/end/task time, mistakes, recovery, draft usefulness and feedback; retain failed criteria. A bounded standard PluginAPI correction returns to local RED→GREEN and the affected native checks. No beta generation or invented participants. Recruitment messages require explicit authorization; none have been sent.

## Production promotion and fresh judging access — final authorization

Only after required gates pass, present the exact source/image/plugin/archive digest, intended target/origin, matching backup and configuration/flag delta for production-promotion approval. Keep unverified features disabled. A deployment success is not an overall release pass.

Before replacement, take the existing supported SQLite backup, copy it off the data disk through the protected channel, hash it and check integrity. Retain the exact previous image and private configuration version. The existing `install-release.sh` is production-specific; inspect target/mount names and use it only under the approved production action.

For recovery, stop/drain the candidate before touching the database. Use the matched prior image/configuration and its verified backup together; do not run old code against an unknown newer schema. Before any backup restoration that could discard newer approvals, provider outcomes, tombstones or AI charges, preserve the current database and reconcile those newer records under a reviewed recovery decision. **Never restore an older budget balance to create spend capacity.** The disposable rehearsal proves the backup mechanism, not a destructive production rollback.

After approved promotion, verify actual image/source/ZIP identity, health/flags, persistent approvals/payment history, signed-event processing and browser/native paths. Any final-origin change rebuilds artifact bytes and repeats affected origin/access checks. Test a fresh account/session and a second isolated run: no cross-run visibility, no shared reset, checksummed plugin installation, expiry/reconnect recovery and reopening the same paid revision. Record independent reviewer/user acceptance.

The official judging close was rechecked at `2026-10-25T12:47:18Z`: **2026-12-15T16:00:00Z**. Existing default entry expiry is **2026-12-16T16:00:00Z**. Recheck the [official rules](https://paypalaihackathon.devpost.com/rules) before any later lifetime change. No credentials or lifetimes were changed here. Supply judge access and sandbox buyer details only through a confirmed private testing channel.
