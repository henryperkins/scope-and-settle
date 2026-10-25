# Paid-team Figma connection — October 24, 2026

> Historical verification recorded October 24, 2026 in the `codex/paid-figma-connection` worktree, based on `68623c0c728faf657b885a319320a539cd9c83db` with local session-switch changes. Consolidated October 25 from those records; the results apply to that development build and the deployed 0.3.0 runtime.

At the October 24 connection check, the active Scope & Settle project used [Scope & Settle — Demo (Copy)](https://www.figma.com/design/xu9KUICNauIGSzSepzGvBE/Scope-and-Settle?node-id=5-2), file key `xu9KUICNauIGSzSepzGvBE`. Figma reported a Professional team and Full seat for Henry Perkins’s team (`1575403650780748133`); the file was in its Scope & Settle project (`676748505`).

## Binding and recovery

- Updated hosted `FIGMA_FILE_KEY` and `projects.figma_file_key`, preserving the rest of the project and runtime environment. The service restarted on the same image, `sha256:d2da90d3d9379355d8ef1eb2de3bbaf615da1ebb4963a21f405fd2fb6205191e`.
- Created fresh judging access and run `judge-154d206a-e5a4-4cd5-84a6-c66b7309f483`, with the new file snapshot and existing `scope-rev-1`. The recorded access expiry was December 16, 2026 at 16:00 UTC. Private credentials are excluded from Git and this report.
- Kept previous judging entries and runs pinned to their original file. The migration transaction verified checksums of every preexisting row across 22 other database tables. A follow-up check allowed only the server's advancing `agent_runtime.worker-last-cycle` heartbeat; orders, approvals, proposal revisions, payment observations, prior runs, and AI accounting remained protected. At this checkpoint, three Paid orders and 31 AI-call records remained.
- Updated the primary checkout’s `.env.local`, saved deployment `output/gcp/private/runtime.env`, and local database project binding. All other configuration bytes, project fields, and local database tables were preserved.
- Hosted recovery files: `/etc/scope-and-settle/runtime-before-paid-figma-2026-10-24.env` and `/srv/scope-and-settle/data/figma-connection-2026-10-24/before.db`. The private access record and sanitized migration manifest were saved alongside that database backup.
- Local configuration/database backups and a private connection record were retained under the original `paid-figma-connection` worktree’s ignored, access-restricted `output/figma-connection/private/`. Original released plugin files were preserved under the `judging-access` worktree’s `output/agent-verification/plugin-0.3.0-final/`.

## Verification

| Check | Result |
| --- | --- |
| Figma MCP access to the copy | Successful; correct checkout frame |
| Hosted server token: Figma comments | HTTP 200; zero comments |
| Hosted server token: Figma node `5:2` | HTTP 200; checkout frame, 1200 × 982 |
| Hosted health, demo info, authenticated project and comments | HTTP 200; runtime, project, public link and fresh run agreed on the copy |
| Native Figma Beta | Connected to the designated file; selected checkout frame exported and displayed in the plugin preview; designer session restored automatically after closing and reopening |
| Focused designer workflow tests | Four passed; zero failed or skipped |
| TypeScript and plugin build | Passed with the hosted API origin |

The local October 24 plugin included **Demo controls → Switch designer session**. It cleared the local session view and stopped its agent polling without resetting orders or revoking access to the prior run. It also cleared the previous request, proposal and attached frame before reconnecting. The four focused tests recorded above covered browser and plugin behavior in that build.

**October 25 consolidation decision:** the session-switch experiment is deferred from the consolidated release. A subsequent audit found that old in-flight renewals and requests need session-change fencing before this feature can be integrated safely.

At this checkpoint, Figma’s development registration pointed to the `paid-figma-connection` worktree’s `app/plugin/dist/manifest.json`; the older registration was removed, with its files preserved. This was a local development build. The hosted server image and published 0.3.0 ZIP were not replaced during this check, and the source changes were uncommitted at the time.

## Remaining boundaries

At the time of this connection check, the copy contained no request comments. No comment was posted, AI assessment run, quote issued, automation enabled, or payment changed during that check. The owner subsequently authorized posting the mobile-checkout request and testing its assessment; see [the later assessment verification](FIGMA-ASSESSMENT-2026-10-24.md). Independent judge edit access to this new file was not tested in these records. Previous paid-run evidence remained attached to the original file and its immutable snapshots.
