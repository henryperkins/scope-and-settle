import { randomUUID } from "node:crypto";
import { db, transaction } from "./db.js";
import { config } from "./env.js";

export interface BudgetReservation {
  id: string;
  reservedMicroUsd: number;
  release: (actualMicroUsd?: number, usage?: { model: string; inputTokens: number; outputTokens: number }) => void;
}

class AiBudget {
  constructor(private readonly capMicroUsd: number) {
    if (!Number.isSafeInteger(capMicroUsd) || capMicroUsd < 0) throw new Error("Invalid AI budget");
  }

  /** Conservative per-request estimate in micro-USD (1 USD = 1_000_000). */
  estimate(inputTokens: number, maxOutputTokens: number, inputRatePerMTok: number, outputRatePerMTok: number): number {
    return Math.ceil((inputTokens / 1_000_000) * inputRatePerMTok + (maxOutputTokens / 1_000_000) * outputRatePerMTok);
  }

  reserve(estimatedMicroUsd: number): BudgetReservation | null {
    if (!Number.isSafeInteger(estimatedMicroUsd) || estimatedMicroUsd <= 0) throw new Error("Invalid AI reservation");
    const id = randomUUID();
    const accepted = transaction(() => {
      if (this.status().remainingMicroUsd < estimatedMicroUsd) return false;
      db.prepare("INSERT INTO ai_calls (id,reserved_micro_usd,created_at) VALUES (?,?,?)").run(id, estimatedMicroUsd, new Date().toISOString());
      return true;
    });
    if (!accepted) return null;
    return {
      id,
      reservedMicroUsd: estimatedMicroUsd,
      release: (actualMicroUsd = estimatedMicroUsd, usage) => {
        if (!Number.isSafeInteger(actualMicroUsd) || actualMicroUsd < 0) throw new Error("Invalid AI cost");
        db.prepare(`UPDATE ai_calls SET actual_micro_usd = ?, model = ?, input_tokens = ?, output_tokens = ?, settled_at = ? WHERE id = ? AND actual_micro_usd IS NULL`)
          .run(actualMicroUsd, usage?.model ?? null, usage?.inputTokens ?? null, usage?.outputTokens ?? null, new Date().toISOString(), id);
      },
    };
  }

  status() {
    const totals = db.prepare(`SELECT COALESCE(SUM(actual_micro_usd),0) spent,
      COALESCE(SUM(CASE WHEN actual_micro_usd IS NULL THEN reserved_micro_usd ELSE 0 END),0) reserved FROM ai_calls`).get() as any;
    return { capMicroUsd: this.capMicroUsd, spentMicroUsd: totals.spent, reservedMicroUsd: totals.reserved,
      remainingMicroUsd: Math.max(0, this.capMicroUsd - totals.spent - totals.reserved) };
  }
}

// Default development/demo cap: $25. Configure via AI_BUDGET_USD.
// Unsettled calls stay reserved after a crash. Demo reset never clears this ledger.
export const aiBudget = new AiBudget(Math.round(config.aiBudgetUsd * 1_000_000));
