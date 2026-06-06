"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Work, Bounty } from "@/lib/supabase";
import type { FeeMode } from "@/lib/supabase";
import { apiGet, apiPost, apiUpload } from "@/lib/api";
import { useIdentity } from "@/lib/use-identity";
import {
  computeSplitPreview,
  RARE_FORGE_FEE_PERCENT,
  type RoyaltyRow,
} from "@/lib/split-preview";
import { RequireWallet } from "@/components/require-wallet";
import { RoyaltyTable } from "@/components/royalty-table";
import { Spinner } from "@/components/spinner";
import { TxPending } from "@/components/tx-pending";
import { Select } from "@/components/select";
import { FileInput } from "@/components/file-input";

type Board = { work: Work; bounties: Bounty[] };
type BreakdownRow = {
  address: string;
  role: string;
  percentOfWork: number;
  onchainRatio: number;
};

const SEAL_STEPS = [
  "Deploying release contract…",
  "Preparing lazy mint…",
  "Configuring split…",
];

export default function SealPage({ params }: { params: { id: string } }) {
  return (
    <RequireWallet>
      <SealInner workId={params.id} />
    </RequireWallet>
  );
}

function SealInner({ workId }: { workId: string }) {
  const { address } = useIdentity();

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [basePriceEth, setBasePriceEth] = useState("0.0001");
  const [feeMode, setFeeMode] = useState<FeeMode>("absorb");
  const [cover, setCover] = useState<File | null>(null);

  const [sealing, setSealing] = useState(false);
  const [sealError, setSealError] = useState<string | null>(null);
  const [result, setResult] = useState<BreakdownRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      setBoard(await apiGet<Board>(`/api/works/${workId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-t3">
        <Spinner /> Loading…
      </div>
    );
  }
  if (error || !board) {
    return <div className="card bg-danger-subtle text-danger">{error ?? "Not found"}</div>;
  }

  const { work, bounties } = board;
  const isProducer = address?.toLowerCase() === work.requester_addr.toLowerCase();

  if (!isProducer) {
    return (
      <div className="card text-t3">
        Only the producer can seal this work.{" "}
        <Link href={`/work/${work.id}`} className="text-accent">
          Back to board
        </Link>
      </div>
    );
  }
  if (work.status === "sealed") {
    return (
      <div className="card">
        <p>This work is already sealed.</p>
        <Link href={`/work/${work.id}/store`} className="btn-primary mt-4">
          Go to store ↗
        </Link>
      </div>
    );
  }

  // Participants the producer assigned a share to; only MINTED ones enter the split.
  const assigned = bounties.filter((b) => (b.revenue_percent ?? 0) > 0);
  const minted = assigned.filter((b) => b.status === "minted" && b.claimed_by);
  const preview = computeSplitPreview(minted.map((b) => b.revenue_percent!));
  const ratioByBounty = new Map<string, number>();
  minted.forEach((b, i) => ratioByBounty.set(b.id, preview.participantRatios[i]));

  const grossPrice =
    feeMode === "passthrough"
      ? (Number(basePriceEth) / (1 - RARE_FORGE_FEE_PERCENT / 100)).toFixed(6)
      : basePriceEth;

  async function seal() {
    if (sealing) return;
    if (!cover) {
      setSealError("Upload a cover image for the work.");
      return;
    }
    if (minted.length === 0) {
      setSealError("Mint at least one asset before sealing.");
      return;
    }
    setSealing(true);
    setSealError(null);
    try {
      const { path } = await apiUpload(cover);
      const data = await apiPost<{ work: Work; breakdown: BreakdownRow[] }>(
        `/api/works/${workId}/seal`,
        { basePriceEth: Number(basePriceEth), feeMode, imagePath: path }
      );
      setResult(data.breakdown);
    } catch (e) {
      setSealError(e instanceof Error ? e.message : "Seal failed");
      setSealing(false);
    }
  }

  // Success state: show the authoritative on-chain breakdown returned by the API.
  if (result) {
    const rows: RoyaltyRow[] = result.map((r) => ({
      role: r.role,
      address: r.role === "rare_forge_fee" ? "" : r.address,
      ratio: r.onchainRatio,
      assigned: r.percentOfWork,
      tint: r.role === "rare_forge_fee" ? "info" : undefined,
    }));
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="rf-display text-3xl">
          Work <span className="rf-prism-text">sealed</span>
        </h1>
        <p className="mt-1 text-sm text-t3">
          The release is live. Every copy sold pays this split automatically.
        </p>
        <div className="card mt-6 shadow-glow-prism">
          <SplitPanelHeader />
          <RoyaltyTable rows={rows} />
        </div>
        <Link href={`/work/${work.id}/store`} className="btn-primary mt-6 shadow-glow-accent">
          Go to store ↗
        </Link>
      </div>
    );
  }

  const previewRows: RoyaltyRow[] = [
    {
      role: "principal",
      address: work.requester_addr,
      ratio: preview.principalRatio,
      assigned: preview.principalPercent,
    },
    ...assigned.map((b) => ({
      role: b.role,
      address: b.claimed_by ?? "",
      ratio: ratioByBounty.has(b.id) ? ratioByBounty.get(b.id)! : null,
      assigned: b.revenue_percent ?? 0,
      dim: !ratioByBounty.has(b.id),
    })),
    {
      role: "rare_forge_fee",
      address: "",
      ratio: preview.feePercent,
      tint: "info" as const,
    },
  ];

  return (
    <div>
      <Link href={`/work/${work.id}`} className="text-sm text-t3 hover:text-t1">
        ← {work.title}
      </Link>
      <h1 className="mt-3 rf-display text-3xl">Seal work</h1>
      <p className="text-sm text-t3">
        Configure the copy-sale release. The revenue split is baked in and applies
        to every copy.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Settings */}
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="price">Price per copy (ETH)</label>
            <input
              id="price"
              className="input"
              type="number"
              step="0.0001"
              min="0"
              value={basePriceEth}
              onChange={(e) => setBasePriceEth(e.target.value)}
              disabled={sealing}
            />
          </div>

          <div>
            <label className="label" htmlFor="fee">Who absorbs the 3% fee?</label>
            <Select
              id="fee"
              value={feeMode}
              onChange={(e) => setFeeMode(e.target.value as FeeMode)}
              disabled={sealing}
            >
              <option value="absorb">Creator (absorb) — fee comes out of price</option>
              <option value="passthrough">Buyer (passthrough) — price grossed up</option>
            </Select>
            <p className="mt-1 text-xs text-t3">
              {feeMode === "passthrough"
                ? <>Buyer pays ~<span className="rf-data">{grossPrice} ETH</span>; creators keep their full share.</>
                : "Fee is carved out of the price; creators net a bit less."}
            </p>
          </div>

          <div>
            <label className="label">Work cover image</label>
            <FileInput
              accept="image/*"
              disabled={sealing}
              onChange={setCover}
              label="Choose cover image"
            />
          </div>
        </div>

        {/* Split preview — the prism moment: one payment refracted into shares. */}
        <div className="card shadow-glow-prism">
          <SplitPanelHeader />
          <RoyaltyTable rows={previewRows} />
          <p className="mt-3 text-xs text-t4">
            Only participants with a minted asset enter the split. Percentages are
            rounded to integers; remainder goes to the principal.
          </p>
        </div>
      </div>

      {sealError && <p className="mt-4 text-sm text-danger">{sealError}</p>}

      {sealing ? (
        <div className="mt-6">
          <TxPending
            title="Sealing… 3 on-chain transactions, this can take 1–2 min."
            steps={SEAL_STEPS}
          />
        </div>
      ) : (
        <button className="btn-primary mt-6 shadow-glow-accent" onClick={seal}>
          Confirm and seal ↗
        </button>
      )}
    </div>
  );
}

/** Prism-accented header for the split panel — the metaphor made literal. */
function SplitPanelHeader() {
  return (
    <>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="rf-eyebrow">Revenue split</span>
        <span className="rf-data text-xs text-t4">one payment, refracted</span>
      </div>
      <hr className="rf-prism-rule mb-3" />
    </>
  );
}

