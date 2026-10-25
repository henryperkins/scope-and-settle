# Good Terms 0.3.1 release verification — October 25, 2026

Good Terms is deployed at [judge entry](https://scope-and-settle.hperkins.com/judge). [PR #1](https://github.com/henryperkins/scope-and-settle/pull/1) was fast-forwarded into `main` at `49997450d4f00fb30017ffd098169216b5ee4a7e`, including the reconnect-banner correction. Release preparation then consolidated the dated paid-team records, corrected the judging-file access claim, and bumped the version to 0.3.1.

## Released identities

| Item | Verified value |
| --- | --- |
| Version / tag | [v0.3.1](https://github.com/henryperkins/scope-and-settle/releases/tag/v0.3.1) |
| Source commit | `ebbed27123f33d2ba6f30d7ea9a35c5d2df2d16c` |
| Runtime image configuration digest | `sha256:8da99f893246710ea6089c8163187df9b77a7d3a3072804c26a2af81d93e8a8d` |
| Plugin ZIP | [scope-and-settle-0.3.1-ebbed27123f3.zip](https://scope-and-settle.hperkins.com/downloads/scope-and-settle-0.3.1-ebbed27123f3.zip) |
| ZIP SHA-256 | `5f2f2f92eea71337a18b3def9ba81a9b01d01bf90d0041bb0794a5021a96aaaf` |
| Compressed image archive SHA-256 | `a801cfd5bb64c186c83ac40da2ed1bd3e1e356d7785b62dabad9a9160b88e99e` |

The hosted metadata, downloaded ZIP and GitHub asset agree on the source, version and ZIP hash. `SOURCE.json` verifies the manifest, code, UI and bundled judging instructions. Later documentation commits do not change these released bytes.

## Build and deployment checks

- Windows suite: **81 passed, 0 failed, 0 skipped**.
- Clean-source Linux suite: **81 passed, 0 failed, 0 skipped**, using the committed Git archive and pinned Node 24 image.
- Container replacement preserved its disposable session, order and AI spending ledger. Anonymous access was rejected; the runtime is UID 1000 and contains no local credentials, developer database or `node_modules`.
- All 48 runtime files were readable by UID 1000. Fifteen public routes passed exact-content and MIME checks in an isolated container. Source extraction content and permissions matched the archive.
- The image archive's configuration and all 14 layers matched the image that passed smoke checks. Production Docker 20.10 loaded and verified its configuration digest before activation.
- A consistent SQLite backup was downloaded privately and independently checked for matching SHA-256, integrity and foreign keys before activation. The prior image and backups were retained for recovery.
- Activation changed the image reference and restarted the app. Runtime and tunnel configuration hashes, tunnel service and persistent database mount were preserved.
- Before/after standalone backups matched across all 23 application tables and `sqlite_sequence`. Only the existing `agent_runtime.worker-last-cycle` timestamp advanced. No other insertion, deletion or changed value was accepted. Schema, integrity, foreign keys and AI accounting matched; the hosted ledger remained at 32 calls, 135,269 micro-USD recorded spend and zero unsettled reservations. This is the hosted ledger, not total development spending or a provider bill.
- Public health reports `ok: true`, no missing settings and PayPal sandbox. The four public pages return 200; anonymous project, comments and order APIs return 401. The public font matches its committed source bytes.

The first candidate failed the pre-activation check: extracting source under a restrictive umask had made root-owned runtime files unreadable by UID 1000. It was never activated. A second build preserved the Git archive's permissions and passed the added runtime-file and HTTP checks. Both attempts' evidence is retained; the image above is the accepted second build.

At the PR head, CodeRabbit, GitGuardian and qlty completed successfully, and all six review threads were resolved. Sourcery skipped the oversized diff; Mergestorm reported exhausted review credits. These unavailable reviews are not counted as passes.

## Exact public ZIP in native Figma

The ZIP was downloaded from the public deployment, hash-checked, extracted and imported through Figma Beta 126.11.5 on Windows. The superseded development registration was removed through Figma; its source files remain intact. The single Scope & Settle registration points to the extracted public ZIP.

Using the owner's existing Figma account in `Scope & Settle — Demo (Copy)`, file `xu9KUICNauIGSzSepzGvBE`, the following checks passed:

1. The stale fixture access produced the expected expiry message. Connecting with the existing hosted designer access opened the workspace and removed that old error.
2. The saved **Add mobile checkout** order appeared at the Payment stage, revision 1 / `scope-rev-1`, with $250 due and its previously recorded payment observation. No payment-refresh action was needed or performed.
3. Explicit Figma Light and Dark preferences updated the plugin live. Text, controls, invoice actions and footer remained visible and reachable by scrolling at 440 × 720.
4. Selecting the actual 1200 × 995 checkout frame and choosing **Attach selected frame** displayed its exported PNG preview. The real Figma request was listed. No new assessment was requested.
5. Closing and reopening the plugin restored the hosted designer session and same invoice without entering access again. The original System theme preference was restored and verified in Figma's saved settings.

Native screenshots, sanitized reports and build/deployment logs are retained under the ignored operator directory `output/good-terms-release-2026-10-25/`; private database backups are access-restricted and excluded from publication. The earlier [fixture-based native verification](GOOD-TERMS-NATIVE-VERIFICATION-2026-10-25.md) records the reconnect regression's red/green test and isolated theme checks separately.

## Scope and remaining submission gates

This release created no new live AI assessment, invoice, payment, Figma comment or outbound reply. Historical provider evidence is preserved in the [0.3.0 agent record](CLIENT-AGENT-VERIFICATION-2026-10-23.md) and the three dated paid-team [connection](FIGMA-CONNECTION-2026-10-24.md), [assessment](FIGMA-ASSESSMENT-2026-10-24.md) and [invoice](FIGMA-INVOICE-FLOW-2026-10-24.md) records.

The experimental session-switch control is deferred because in-flight requests need session-change fencing. The separate A–C integration branch, including installment reminders, was not merged or deployed with this release.

Independent judge edit access to the current paid-team Figma copy, an updated or supplementary video, 2–3 outside-designer walkthroughs, private testing-field visibility and entrant-only form answers remain open. The existing video is explicitly identified as 0.2.1 manual-workflow footage. Local submission text was refreshed; this release did not update or submit the live Devpost project.
