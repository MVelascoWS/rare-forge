/**
 * CLIENT-SIDE mirror of buildRevenueSplit() in src/lib/rare.ts.
 *
 * rare.ts can't be imported here (it pulls in node:child_process), so this is a
 * faithful copy of the *numeric rule* for the seal screen's preview only. The
 * canonical, on-chain-authoritative computation still happens server-side; the
 * real breakdown returned by POST /api/works/:id/seal is what gets displayed
 * after sealing. Keep this in sync with buildRevenueSplit if that rule changes.
 *
 * Rule: the principal keeps the remainder (100 - Σ participants); the fee is
 * inserted underneath by scaling the creator side into the (100 - fee)% pot;
 * ratios are integers and all rounding remainder goes to the principal.
 */
export const RARE_FORGE_FEE_PERCENT = 3;

export type SplitPreview = {
  principalPercent: number; // principal's share in the 0–100 mental model
  principalRatio: number; // principal's on-chain integer ratio
  participantRatios: number[]; // aligned to the input order
  feePercent: number;
  total: number; // always 100
};

export function computeSplitPreview(
  participantPercents: number[],
  feePercent: number = RARE_FORGE_FEE_PERCENT
): SplitPreview {
  const participantTotal = participantPercents.reduce((s, p) => s + p, 0);
  const principalPercent = Math.max(0, 100 - participantTotal);

  // principal first, then participants — same ordering as buildRevenueSplit.
  const creatorSide = [principalPercent, ...participantPercents];
  const creatorPot = 100 - feePercent;

  const raw = creatorSide.map((p) => (p / 100) * creatorPot);
  const floored = raw.map((r) => Math.floor(r));
  const remainder = creatorPot - floored.reduce((s, x) => s + x, 0);
  const ratios = [...floored];
  ratios[0] += remainder; // all rounding remainder to the principal

  return {
    principalPercent,
    principalRatio: ratios[0],
    participantRatios: ratios.slice(1),
    feePercent,
    total: ratios.reduce((s, x) => s + x, 0) + feePercent,
  };
}
