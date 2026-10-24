# Scope evaluation contract and Release B qualification

Local T13 implementation, 2026-10-24. The held-out model evaluation, substantive evidence review, native connector/inbox qualification and observations of 2–3 designers remain **unrun**. Synthetic tests do not measure model accuracy or user impact.

## Frozen identity and data provenance

The [production contract](scope-evaluation-contract.json) was recorded at `2026-10-24T16:46:33.842Z`, before opening the private draft labels. Its 94 production source/build/script files have source identity `e285bae6fedb963e5e1c4ca872a46d51eca3814f675d4952c5e03d7472c9aa34`. This is an uncommitted source manifest, not a released Git commit. It binds the compiled production `assess` implementation, actual per-item schemas in both manual and automatic modes, model, reasoning setting, generation limits, shared durable work path, scope/rate/commitment validation, eligibility predicates, runtime ownership and CLI adapter. Verification rejects changed bytes; never replace the freeze silently after tuning against these labels.

The provider remains Baseten `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast`, reasoning `max`, item prompt `scope-assessment-items-v4`. No production generation prompt or schema was edited during T13 or after label exposure. A future change to these frozen sources requires an explicitly qualified new evaluation identity. If a generation change uses held-out failures for tuning, these cases become development data and a fresh held-out set is needed.

The original private, author-labeled draft has SHA256 `94c0f7a3035dac79d7943721ecb3c00685dbb9f093966ee4aa4800cc674a3981`. Its 36 scenarios and 45 items were written before T13 without prompt/tuning-fixture access. The original remains intact in the local task evidence. Labels have no human validation.

The [adapted held-out fixture](../../fixtures/scope-held-out-cases.json) contains **34 scenarios / 43 items**: 20 included, 18 clearly new, 5 ambiguous. Eleven items are labeled eligible for catalogue billing; new work can still require pricing or quantity clarification. SHA256: `34a60b4acb726041894aa8ca55885fcebc664d21787421d745eb45c73fc4944d`. Categories cover mixed requests, included work, additions, commitments, ambiguous pricing, contradictory clauses, stale contextual evidence and instruction injection. The six [public baseline cases](../../fixtures/scope-baseline-cases.json) are separate; older legacy judgment fixtures and historical evaluator outputs are retained with their original meaning.

[Case notes](scope-evaluation-case-notes.json) preserve the original item labels/evidence, adaptation time, exclusions and limitations. H017 is excluded because it depends on a pre-existing authenticated designer duplicate decision, which this read-only adapter does not manufacture. H023 is excluded because the frozen evaluator supports USD and cannot faithfully represent its EUR rate snapshot. These are pre-execution representation exclusions, not removal of failed model outputs. The adapted recognition denominator is 18, so the proposed 90% bar requires at least **17/18**; the included/ambiguous safety denominator is **25**.

## Execution and authority

The CLI passes only the selected case's validated `input` to the executor. IDs, tags, expected labels, rationales, case notes and other cases never enter provider input. The executor constructs the actual production itemized assessment request and calls `prepareAssessmentWork` / `executeAssessmentWork` with production `assess`, its dispatch hooks and the existing SQLite budget ledger. It does not use the old legacy-classification bypass. The held-out set uses manual itemized mode; the frozen automatic schema is identified but automatic policy execution is not evaluated by these model cases.

Each case uses an isolated synthetic run whose stable identity depends on its input and inference identity, excluding output label and expected truth. The application's demo project is not overwritten. Synthetic prior commitments are seeded only in that evaluation namespace, with no access grants, real client approval, invoice or provider action. These synthetic approval rows are fixture state and must never be presented as actual consent. Current clauses/rates retain their exact text, IDs and cents; the database assigns immutable snapshot/resource identities. Original commitment names are preserved as titles.

Original design descriptions, financial observations and historical workflow facts are explicitly quoted as **untrusted client text**. They are not real pixels, verified payment observations, native history or recorded designer authority. Consequently these cases test text handling only. They cannot establish vision quality, native evidence freshness, stale-proposal mutation safety, cancellation/refund handling or authenticated duplicate resolution. Separate application tests and actual integration evidence are required for those behaviors. The baseline known-unavailable-source case exercises the persistent source fence without inference; it is distinct from the held-out stale-text scenarios.

Billability is derived after production validation and immutable-item persistence using the same internal eligibility predicate as proposal reservation, including source/context freshness, lineage, duplicate review, exact commitments, price completeness and questions. Existing reservations remain blocked. No proposal is created merely to score a case. Per-item output retains raw classification, resolved rates/amounts, evidence, guarded eligibility and any refusal. A programming/database error cannot become an eligible negative decision.

The server and CLI share an OS-owned exclusive database admission lock. Tests cover same-process contention, another process, process termination recovery, a listening server versus evaluator, and shutdown draining. The supported Node 24 Windows/Linux implementation uses a named pipe or abstract Unix socket; see the [Node net documentation](https://nodejs.org/download/release/v24.19.0/docs/api/net.html). Other platforms use a deterministic loopback-port lock and fail closed on a collision. This is admission for these two entry points, not a multi-process database scheduler or authorization for direct internal-module dispatch. Stop the server and wait for its drain before using the same ledger for evaluation.

## Accounting, partial runs and reports

The report retains fixture SHA256, frozen source/model/prompt/schema identity, case outcomes, item counts, raw and guarded results, latency and cost. Look up each case's expected classification, price and substantive evidence in the exact hashed fixture and case notes. Exact-quote one-to-one alignment is conservative: alternative valid splits/paraphrases can fail automatic alignment and require a separate semantic assessment; do not silently relabel the automatic result. Review the channel-equivalence pair separately.

All expected items remain in the denominators, including missing outputs, rejected responses, uncertain attempts, skipped and unattempted cases. Rejection/unknown/skips are not passes. Clearly new unpriced items remain in scope-recognition totals. Raw classifications and guarded billing are separate: an included item classified as new is a raw error even when a duplicate guard prevents charging it. Unexpected billable output is unsafe. Rate/amount mismatches and unchecked eligibility block the computed metric bar.

`metricsPass` is a limited computed result: complete coverage, no missing/unexpected items, no false billability, no unsafe billed terms, checked eligibility, and at least 90% recognition. `cases.passed` is the stricter exact classification/rate/amount diagnostic and can differ. The report's `duplicateInvariantFailures` counter detects billable projections on labeled blocked commitment items; it does **not** run reservation/concurrency experiments. Its zero is not database-invariant proof. The existing request-item/paid-work tests and whole-release review supply that separate proof. `releaseBPassed` remains false: this harness cannot certify the external gates or semantic support.

Costs distinguish known provider usage from conservative charges when usage is missing. Referenced calls are deduplicated by durable call ID; `newChargedMicroUsd` distinguishes new work from cached lookups. Reused results are marked and do not claim a new provider dispatch. Provider reasoning, API keys, provider error bodies and raw rejected final output are not printed or attached to reports. Reports are local operational artifacts and contain synthetic terms and ledger references.

An atomic checkpoint is saved before execution and synchronously before provider dispatch. Every completed snapshot report has a unique filename and is retained. Resume must match the fixture, contract and evidence mode. Completed/rejected/uncertain cases are not retried. Interrupted prepared/dispatched checkpoint entries become uncertain; the durable attempt also prevents paid repetition even under a different report label. An uncertain report may require read-only reconciliation with its durable attempt; this CLI does not automatically reconstruct lost reporting results or authorize a replacement call.

## Commands and budget prerequisites

From `app/`, these commands validate only. They load no provider credentials, create no database, produce no model score and make zero provider calls:

```powershell
npm.cmd run eval:ai -- --fixtures ../fixtures/scope-baseline-cases.json --output-label baseline
npm.cmd run eval:ai -- --fixtures ../fixtures/scope-held-out-cases.json --output-label release-b --contract ../docs/verification/scope-evaluation-contract.json
```

Live inference remains separately cleared. Before that invocation, identify the **existing designated** `scope-and-settle.db` and reviewed allocation across all development ledgers. Do not copy an empty database, delete history, reset an allowance or raise the combined $25 ceiling. Check the remaining allocation and the conservative full-context reservation for every prospective call. A 34-case set may not fit the existing remaining allowance; an incomplete run must remain incomplete.

The explicit live CLI also requires `--live --ledger <existing-file> --allocation <reviewed-json>`. The allocation JSON has `schemaVersion: 1`, `reviewed: true`, the absolute `ledgerPath`, `historyHash`, `capMicroUsd`, `otherAllocatedMicroUsd` and `globalCapMicroUsd: 25000000`. `historyHash` is SHA256 of `JSON.stringify` applied to `SELECT * FROM ai_calls ORDER BY created_at,id`. The cap must equal current runtime budget configuration; cap plus other existing allocations must not exceed $25. Empty history, changed history, wrong ledger, insufficient balance or ownership contention refuses execution before a provider call. `reviewed` is an operator attestation, not automatic discovery or approval of other ledgers. Recheck and issue a newly reviewed history-bound allocation for a later resume.

`--limit <positive-count>` creates an honest partial run; `--resume` requires explicit live mode and an existing matching checkpoint. Unknown, duplicate, missing-value and unsafe-label arguments fail before runtime loading. Historical evaluation reports are never reinterpreted as this new contract.

## Remaining Release B evidence

- Live held-out results through the designated existing allocation, plus item-by-item semantic evidence review and the proposed safety/recognition bar.
- Zero duplicate-proposal invariant failures from application checks, including repeated-operation reuse, active reservation uniqueness and changed model output.
- Actual supported-client connector/instruction proof, native linked-card proof and background Figma inbox proof.
- Observations of 2–3 actual designers: task time, decisions, recovery and comments, without invented impact claims.
- The batched Release B review/minors wave, final local suite/checkpoint and external release qualification recorded separately.
