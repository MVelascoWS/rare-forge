"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Work, Bounty } from "@/lib/supabase";
import { apiGet, apiPost, apiUpload } from "@/lib/api";
import { useIdentity, truncateAddress } from "@/lib/use-identity";
import { buildRoyaltyRows } from "@/lib/split-preview";
import { servedUrl, isImagePath, fileTypeLabel } from "@/lib/files";
import { RequireWallet } from "@/components/require-wallet";
import { WorkStatusPill, BountyStatusPill } from "@/components/status-pill";
import { Metric } from "@/components/metric";
import { Address, TxLink } from "@/components/data";
import { RoyaltyTable } from "@/components/royalty-table";
import { AssetThumb } from "@/components/asset-thumb";
import { AssetPreview } from "@/components/asset-preview";
import { Select } from "@/components/select";
import { FileInput } from "@/components/file-input";
import { Modal } from "@/components/modal";
import { Spinner } from "@/components/spinner";
import { TxPending } from "@/components/tx-pending";

type Board = { work: Work; bounties: Bounty[] };

const ROLES = [
  "concept_artist",
  "modeler",
  "animator",
  "musician",
  "writer",
  "programmer",
  "other",
];

export default function WorkBoardPage({ params }: { params: { id: string } }) {
  return (
    <RequireWallet>
      <BoardInner workId={params.id} />
    </RequireWallet>
  );
}

function BoardInner({ workId }: { workId: string }) {
  const { address } = useIdentity();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openBountyOpen, setOpenBountyOpen] = useState(false);
  const [reviewing, setReviewing] = useState<Bounty | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<Board>(`/api/works/${workId}`);
      setBoard(data);
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
        <Spinner /> Loading work…
      </div>
    );
  }
  if (error || !board) {
    return <div className="card bg-danger-subtle text-danger">{error ?? "Not found"}</div>;
  }

  const { work, bounties } = board;
  const isProducer = address?.toLowerCase() === work.requester_addr.toLowerCase();
  const mintedCount = bounties.filter((b) => b.status === "minted").length;
  const totalAssigned = bounties.reduce((s, b) => s + (b.revenue_percent ?? 0), 0);
  const canSeal = work.status === "open" && mintedCount >= 1;

  // Royalty recipients (sealed work): principal + minted participants + fee.
  const royaltyRows = buildRoyaltyRows(
    work.requester_addr,
    bounties
      .filter((b) => b.status === "minted" && b.claimed_by && (b.revenue_percent ?? 0) > 0)
      .map((b) => ({ address: b.claimed_by!, role: b.role, percent: b.revenue_percent! }))
  );

  return (
    <div>
      <Link href="/works" className="text-sm text-t3 hover:text-t1">
        ← Works
      </Link>

      {/* Header */}
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="rf-display text-3xl">{work.title}</h1>
            <WorkStatusPill status={work.status} />
          </div>
          <p className="mt-1 text-sm text-t3">{work.description || "Video game"}</p>
          <div className="mt-2 space-y-0.5 text-xs text-t4">
            {work.asset_contract && (
              <div>
                asset contract <Address value={work.asset_contract} link />
              </div>
            )}
            {work.status === "sealed" && work.work_contract && (
              <div>
                work contract <Address value={work.work_contract} link />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isProducer && work.status === "open" && (
            <button className="btn-ghost" onClick={() => setOpenBountyOpen(true)}>
              + Open bounty
            </button>
          )}
          {work.status === "sealed" ? (
            <Link href={`/work/${work.id}/store`} className="btn-primary">
              Go to store ↗
            </Link>
          ) : (
            isProducer && (
              <Link
                href={canSeal ? `/work/${work.id}/seal` : "#"}
                className={`btn-primary ${canSeal ? "shadow-glow-prism" : ""}`}
                aria-disabled={!canSeal}
                onClick={(e) => !canSeal && e.preventDefault()}
                style={!canSeal ? { opacity: 0.5, pointerEvents: "none" } : undefined}
                title={canSeal ? undefined : "Mint at least one asset first"}
              >
                Seal work ↗
              </Link>
            )
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Metric label="Bounties" value={bounties.length} />
        <Metric label="Minted" value={mintedCount} />
        <Metric label="% assigned" value={`${totalAssigned}%`} />
      </div>

      {/* Royalty recipients (transparency) — every sale pays this split. */}
      {work.status === "sealed" && (
        <div className="card mb-6">
          <h2 className="rf-eyebrow mb-3">Royalty recipients · every sale</h2>
          <RoyaltyTable rows={royaltyRows} />
        </div>
      )}

      {/* Bounty list */}
      {bounties.length === 0 ? (
        <div className="card text-center text-t3">
          No bounties yet.{" "}
          {isProducer ? "Open one to request an asset." : "Nothing to show."}
        </div>
      ) : (
        <div className="space-y-2">
          {bounties.map((b) => (
            <BountyRow
              key={b.id}
              bounty={b}
              isProducer={isProducer}
              onReview={() => setReviewing(b)}
            />
          ))}
        </div>
      )}

      {!isProducer && (
        <p className="mt-6 text-xs text-t4">
          Read-only — you are not the producer of this work.
        </p>
      )}

      {isProducer && (
        <OpenBountyModal
          open={openBountyOpen}
          onClose={() => setOpenBountyOpen(false)}
          workId={work.id}
          onCreated={() => {
            setOpenBountyOpen(false);
            load();
          }}
        />
      )}

      {isProducer && reviewing && (
        <ReviewModal
          bounty={reviewing}
          assetContract={work.asset_contract}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function BountyRow({
  bounty,
  isProducer,
  onReview,
}: {
  bounty: Bounty;
  isProducer: boolean;
  onReview: () => void;
}) {
  const b = bounty;
  const hasAsset =
    (b.status === "delivered" || b.status === "approved" || b.status === "minted") &&
    !!b.delivery_path;

  return (
    <div className="card flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {hasAsset && <AssetThumb path={b.delivery_path} />}
        <div className="min-w-0">
          <div className="truncate font-medium text-t1">{b.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-t3">
            <span>{b.role}</span>
            <span className="text-t4">·</span>
            <span className="rf-data">{b.reward_eth} ETH</span>
            <span className="text-t4">·</span>
            {b.revenue_percent != null ? (
              <span>
                <span className="rf-data">{b.revenue_percent}%</span> of work
              </span>
            ) : (
              <span className="text-t4">not assigned yet</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {b.status === "claimed" && (
          <BountyStatusPill
            status="claimed"
            label={`claimed · ${truncateAddress(b.claimed_by)}`}
          />
        )}
        {b.status === "open" && <BountyStatusPill status="open" />}
        {b.status === "approved" && (
          <BountyStatusPill status="approved" label="minting…" />
        )}
        {b.status === "delivered" && (
          <>
            <BountyStatusPill status="delivered" />
            {isProducer && (
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={onReview}>
                Review
              </button>
            )}
          </>
        )}
        {b.status === "minted" && (
          <>
            <BountyStatusPill status="minted" />
            {b.tx_hash ? (
              <TxLink hash={b.tx_hash}>token #{b.token_id} ↗</TxLink>
            ) : (
              <span className="rf-data text-xs text-t3">token #{b.token_id}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OpenBountyModal({
  open,
  onClose,
  workId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  workId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [rewardEth, setRewardEth] = useState("0.001");
  const [revenuePercent, setRevenuePercent] = useState("");
  const [instructions, setInstructions] = useState("");
  const [deliverableSpecs, setDeliverableSpecs] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let referencePath: string | undefined;
      if (referenceFile) {
        referencePath = (await apiUpload(referenceFile)).path;
      }
      await apiPost(`/api/works/${workId}`, {
        title: title.trim(),
        role,
        rewardEth: Number(rewardEth),
        revenuePercent: revenuePercent === "" ? undefined : Number(revenuePercent),
        instructions: instructions.trim() || undefined,
        deliverableSpecs: deliverableSpecs.trim() || undefined,
        referencePath,
      });
      setTitle("");
      setRevenuePercent("");
      setInstructions("");
      setDeliverableSpecs("");
      setReferenceFile(null);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open bounty");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Open bounty">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="b-title">Title</label>
          <input
            id="b-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Concept art — protagonist"
            disabled={submitting}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="b-role">Role</label>
            <Select
              id="b-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="label" htmlFor="b-reward">Reward (ETH)</label>
            <input
              id="b-reward"
              className="input"
              type="number"
              step="0.0001"
              min="0"
              value={rewardEth}
              onChange={(e) => setRewardEth(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="b-pct">
            Revenue share <span className="font-normal">(% of work, optional)</span>
          </label>
          <input
            id="b-pct"
            className="input"
            type="number"
            min="0"
            max="100"
            value={revenuePercent}
            onChange={(e) => setRevenuePercent(e.target.value)}
            placeholder="e.g. 5"
            disabled={submitting}
          />
        </div>

        <div>
          <label className="label" htmlFor="b-instr">
            Instructions <span className="font-normal">(optional)</span>
          </label>
          <textarea
            id="b-instr"
            className="input min-h-[70px] resize-y"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should the artist make? Style, references, scope…"
            disabled={submitting}
          />
        </div>

        <div>
          <label className="label" htmlFor="b-specs">
            Deliverable specs <span className="font-normal">(optional)</span>
          </label>
          <textarea
            id="b-specs"
            className="input min-h-[60px] resize-y"
            value={deliverableSpecs}
            onChange={(e) => setDeliverableSpecs(e.target.value)}
            placeholder="e.g. 2048px PNG, transparent bg · or FBX, < 50k tris, PBR"
            disabled={submitting}
          />
        </div>

        <div>
          <label className="label">
            Reference file <span className="font-normal">(optional)</span>
          </label>
          <FileInput
            accept="*"
            disabled={submitting}
            onChange={setReferenceFile}
            label="Choose reference"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting || !title.trim()}>
            {submitting ? <><Spinner /> Opening…</> : "Open bounty"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewModal({
  bounty,
  assetContract,
  onClose,
  onDone,
}: {
  bounty: Bounty;
  assetContract: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<null | "approve" | "changes">(null);
  const [error, setError] = useState<string | null>(null);

  // The minted media is delivery_path (always an image). delivery_ipfs may hold
  // the served URL of the real deliverable (e.g. an FBX/audio file) for download.
  const mediaUrl = servedUrl(bounty.delivery_path);
  const assetUrl = servedUrl(bounty.delivery_ipfs) ?? mediaUrl;
  const assetIsImage = isImagePath(bounty.delivery_ipfs ?? bounty.delivery_path);

  async function approve() {
    if (busy) return;
    if (!assetContract) {
      setError("Work has no asset contract");
      return;
    }
    setBusy("approve");
    setError(null);
    try {
      await apiPost(`/api/bounties/${bounty.id}/approve`, { assetContract });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
      setBusy(null);
    }
  }

  async function requestChanges() {
    if (busy) return;
    setBusy("changes");
    setError(null);
    try {
      await apiPost(`/api/bounties/${bounty.id}/approve`, { action: "request_changes" });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request changes failed");
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Review delivery">
      <div className="space-y-4">
        <AssetPreview path={bounty.delivery_path} alt={bounty.title} className="h-60 w-full" />

        <dl className="space-y-1 text-sm">
          <Row k="Title" v={bounty.title} />
          <Row k="Role" v={bounty.role} />
          <Row k="Creator" v={truncateAddress(bounty.claimed_by)} mono />
          {!assetIsImage && bounty.delivery_ipfs && (
            <Row k="Asset type" v={fileTypeLabel(bounty.delivery_ipfs)} mono />
          )}
        </dl>

        {assetUrl && (
          <a
            href={assetUrl}
            download
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-info hover:underline"
          >
            ↓ Download delivered asset
          </a>
        )}

        {busy === "approve" ? (
          <TxPending
            title="Minting asset to creator…"
            steps={["On-chain transaction on Sepolia — ~10–30s"]}
          />
        ) : (
          <>
            <div className="rounded-md border border-[color:var(--border-subtle)] bg-surface-raised p-3 text-xs text-t3">
              Approving mints the asset to the creator (set as on-chain royalty
              receiver) on Sepolia. This takes ~10–30s.
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={requestChanges} disabled={busy !== null}>
                {busy === "changes" ? <><Spinner /> …</> : "Request changes"}
              </button>
              <button className="btn-primary" onClick={approve} disabled={busy !== null}>
                Approve &amp; mint
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-t3">{k}</dt>
      <dd className={mono ? "rf-data text-t1" : "text-t1"}>{v}</dd>
    </div>
  );
}
