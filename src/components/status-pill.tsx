import type { WorkStatus, BountyStatus } from "@/lib/supabase";

// open = neutral (base .pill); sealed = on-chain release live → verified mint.
const WORK_TONE: Record<WorkStatus, string> = {
  open: "",
  sealed: "bg-verified-subtle text-verified",
};

/** Status pill for a work (open / sealed). */
export function WorkStatusPill({ status }: { status: WorkStatus }) {
  return <span className={`pill ${WORK_TONE[status]}`}>{status}</span>;
}

// On-chain truth (minted/paid) → verified mint, NOT success green (DESIGN_SPEC).
const BOUNTY_TONE: Record<BountyStatus, string> = {
  open: "",
  claimed: "bg-info-subtle text-info",
  delivered: "bg-warning-subtle text-warning",
  approved: "bg-warning-subtle text-warning",
  minted: "bg-verified-subtle text-verified",
};

/** Status pill for a bounty. Optional label override (e.g. "minting…", "paid"). */
export function BountyStatusPill({
  status,
  label,
}: {
  status: BountyStatus;
  label?: string;
}) {
  return <span className={`pill ${BOUNTY_TONE[status]}`}>{label ?? status}</span>;
}
