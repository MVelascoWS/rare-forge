"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Work, Bounty } from "@/lib/supabase";
import { apiGet, apiPost, apiUpload } from "@/lib/api";
import { useIdentity } from "@/lib/use-identity";
import { servedUrl } from "@/lib/files";
import { RequireWallet } from "@/components/require-wallet";
import { BountyStatusPill } from "@/components/status-pill";
import { TxLink, NftLink } from "@/components/data";
import { AssetPreview } from "@/components/asset-preview";
import { Modal } from "@/components/modal";
import { Spinner } from "@/components/spinner";
import { FileInput } from "@/components/file-input";

export default function ArtistPage() {
  return (
    <RequireWallet>
      <ArtistView />
    </RequireWallet>
  );
}

function ArtistView() {
  const { address } = useIdentity();
  const [works, setWorks] = useState<Record<string, Work>>({});
  const [available, setAvailable] = useState<Bounty[]>([]);
  const [mine, setMine] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [delivering, setDelivering] = useState<Bounty | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setError(null);
    try {
      const [worksRes, openRes, mineRes] = await Promise.all([
        apiGet<{ works: Work[] }>("/api/works"),
        apiGet<{ bounties: Bounty[] }>("/api/bounties"),
        apiGet<{ bounties: Bounty[] }>(`/api/bounties?claimedBy=${address}`),
      ]);
      setWorks(Object.fromEntries(worksRes.works.map((w) => [w.id, w])));
      setAvailable(openRes.bounties);
      setMine(mineRes.bounties);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bounties");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-t3">
        <Spinner /> Loading bounties…
      </div>
    );
  }
  if (error) {
    return <div className="card bg-danger-subtle text-danger">{error}</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <span className="rf-eyebrow">Creator workspace</span>
        <h1 className="rf-display mt-2 text-3xl">Artist</h1>
        <p className="mt-1 text-sm text-t3">
          Claim a bounty, deliver your asset, and get paid when it mints.
        </p>
      </div>

      {/* Available bounties */}
      <section>
        <h2 className="rf-eyebrow mb-3">Available bounties</h2>
        {available.length === 0 ? (
          <div className="card text-center text-t3">No open bounties right now.</div>
        ) : (
          <div className="space-y-2">
            {available.map((b) => (
              <AvailableRow
                key={b.id}
                bounty={b}
                workTitle={works[b.work_id]?.title ?? "Unknown work"}
                onClaimed={load}
              />
            ))}
          </div>
        )}
      </section>

      {/* My bounties */}
      <section>
        <h2 className="rf-eyebrow mb-3">My bounties</h2>
        {mine.length === 0 ? (
          <div className="card text-center text-t3">
            You haven&apos;t claimed any bounties yet.
          </div>
        ) : (
          <div className="space-y-2">
            {mine.map((b) => (
              <MineRow
                key={b.id}
                bounty={b}
                work={works[b.work_id]}
                workTitle={works[b.work_id]?.title ?? "Unknown work"}
                onDeliver={() => setDelivering(b)}
              />
            ))}
          </div>
        )}
      </section>

      {delivering && (
        <DeliverModal
          bounty={delivering}
          wallet={address ?? ""}
          onClose={() => setDelivering(null)}
          onDone={() => {
            setDelivering(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function BountyMeta({ workTitle, bounty }: { workTitle: string; bounty: Bounty }) {
  const b = bounty;
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-t1">{b.title}</div>
      <div className="truncate text-xs text-t3">
        <Link href={`/work/${b.work_id}`} className="hover:text-t1">
          {workTitle}
        </Link>
        <span className="text-t4"> · </span>
        {b.role}
        <span className="text-t4"> · </span>
        reward <span className="rf-data">{b.reward_eth} ETH</span>
        {b.revenue_percent != null && (
          <>
            <span className="text-t4"> · </span>
            <span className="rf-data">{b.revenue_percent}%</span> of work
          </>
        )}
      </div>
    </div>
  );
}

function AvailableRow({
  bounty,
  workTitle,
  onClaimed,
}: {
  bounty: Bounty;
  workTitle: string;
  onClaimed: () => void;
}) {
  const { address } = useIdentity();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    if (claiming || !address) return;
    setClaiming(true);
    setError(null);
    try {
      await apiPost(`/api/bounties/${bounty.id}/claim`, {
        wallet: address,
        kind: "human",
      });
      onClaimed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed");
      setClaiming(false);
    }
  }

  return (
    <div className="card flex items-center justify-between gap-4 py-3">
      <BountyMeta workTitle={workTitle} bounty={bounty} />
      <div className="flex shrink-0 items-center gap-2">
        {error && <span className="text-xs text-danger">{error}</span>}
        <button className="btn-primary px-4 py-1.5 text-sm" onClick={claim} disabled={claiming}>
          {claiming ? <><Spinner /> Claiming…</> : "Claim"}
        </button>
      </div>
    </div>
  );
}

function MineRow({
  bounty,
  work,
  workTitle,
  onDeliver,
}: {
  bounty: Bounty;
  work?: Work;
  workTitle: string;
  onDeliver: () => void;
}) {
  const b = bounty;
  const royalty = b.revenue_percent != null ? ` · ${b.revenue_percent}% royalty` : "";
  const minted = b.status === "minted";

  return (
    <div className="card flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {minted && b.delivery_path && (
          <AssetPreview path={b.delivery_path} alt={b.title} className="h-12 w-12 shrink-0" />
        )}
        <BountyMeta workTitle={workTitle} bounty={b} />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {b.status === "claimed" && (
          <button className="btn-ghost px-4 py-1.5 text-sm" onClick={onDeliver}>
            Deliver
          </button>
        )}
        {b.status === "delivered" && <BountyStatusPill status="delivered" label="in review" />}
        {b.status === "approved" && <BountyStatusPill status="approved" label="minting…" />}
        {minted && (
          <>
            <BountyStatusPill status="minted" label="paid" />
            <div className="flex flex-col items-end gap-0.5 text-xs">
              <span className="rf-data text-t3">
                token #{b.token_id}
                {royalty}
              </span>
              <div className="flex gap-2">
                {b.tx_hash && <TxLink hash={b.tx_hash}>payment ↗</TxLink>}
                {work?.asset_contract && b.token_id && (
                  <NftLink contract={work.asset_contract} tokenId={b.token_id}>
                    NFT ↗
                  </NftLink>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DeliverModal({
  bounty,
  wallet,
  onClose,
  onDone,
}: {
  bounty: Bounty;
  wallet: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [asset, setAsset] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [step, setStep] = useState<null | "uploading" | "saving">(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step !== null;

  const assetIsImage = asset?.type.startsWith("image/") ?? false;
  // Non-image assets (FBX, audio, …) need an image for the NFT media (the mint).
  const needsPreview = !!asset && !assetIsImage;
  const canSubmit = !!asset && (assetIsImage || !!preview);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!asset || busy) return;
    if (needsPreview && !preview) {
      setError("This asset isn't an image — add a preview image for the NFT media.");
      return;
    }
    setError(null);
    try {
      setStep("uploading");
      const assetRes = await apiUpload(asset);
      // delivery_path is the IMAGE minted as NFT media; delivery_ipfs records the
      // real deliverable's served URL (for preview/download). For an image asset
      // they're the same file.
      let deliveryPath = assetRes.path;
      let deliveryIpfs: string | undefined = assetRes.url;
      if (!assetRes.isImage) {
        const previewRes = await apiUpload(preview!);
        deliveryPath = previewRes.path;
        deliveryIpfs = assetRes.url;
      }
      setStep("saving");
      await apiPost(`/api/bounties/${bounty.id}/deliver`, {
        wallet,
        deliveryPath,
        deliveryIpfs,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delivery failed");
      setStep(null);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Deliver asset">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-t3">
          Deliver your asset for <span className="text-t1">{bounty.title}</span>.
          Any file type is accepted; it&apos;s minted to you when the producer
          approves.
        </p>

        {(bounty.instructions || bounty.deliverable_specs || bounty.reference_path) && (
          <div className="space-y-3 rounded-md border border-[color:var(--border-subtle)] bg-surface-raised p-3">
            {bounty.instructions && (
              <div>
                <div className="rf-eyebrow mb-1">Instructions</div>
                <p className="whitespace-pre-wrap text-sm text-t2">{bounty.instructions}</p>
              </div>
            )}
            {bounty.deliverable_specs && (
              <div>
                <div className="rf-eyebrow mb-1">Deliverable specs</div>
                <p className="whitespace-pre-wrap text-sm text-t2">{bounty.deliverable_specs}</p>
              </div>
            )}
            {bounty.reference_path && servedUrl(bounty.reference_path) && (
              <a
                href={servedUrl(bounty.reference_path)!}
                download
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-info hover:underline"
              >
                ↓ Download reference
              </a>
            )}
          </div>
        )}

        <div>
          <label className="label">Deliverable</label>
          <FileInput accept="*" disabled={busy} onChange={setAsset} label="Choose asset" />
        </div>

        {needsPreview && (
          <div className="rounded-md border border-[color:var(--border-subtle)] bg-surface-raised p-3">
            <p className="mb-2 text-xs text-t3">
              <span className="rf-data text-t2">{asset?.name}</span> isn&apos;t an
              image. Add a preview image — it becomes the NFT media; your file
              stays the deliverable.
            </p>
            <FileInput
              accept="image/*"
              disabled={busy}
              onChange={setPreview}
              label="Choose preview image"
            />
          </div>
        )}

        <p className="text-xs text-t4">
          Roadmap: the real working file (3D/audio) and the NFT preview image will
          be first-class, separate fields. For the MVP the image is the minted
          media.
        </p>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
            {step === "uploading" ? (
              <><Spinner /> Uploading…</>
            ) : step === "saving" ? (
              <><Spinner /> Submitting…</>
            ) : (
              "Deliver"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
