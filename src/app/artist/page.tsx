"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Work, Bounty } from "@/lib/supabase";
import { apiGet, apiPost, apiUpload } from "@/lib/api";
import { useIdentity } from "@/lib/use-identity";
import { RequireWallet } from "@/components/require-wallet";
import { BountyStatusPill } from "@/components/status-pill";
import { TxLink } from "@/components/data";
import { Modal } from "@/components/modal";
import { Spinner } from "@/components/spinner";

export default function ArtistPage() {
  return (
    <RequireWallet>
      <ArtistView />
    </RequireWallet>
  );
}

function ArtistView() {
  const { address } = useIdentity();
  const [titles, setTitles] = useState<Record<string, string>>({});
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
      setTitles(Object.fromEntries(worksRes.works.map((w) => [w.id, w.title])));
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
                workTitle={titles[b.work_id] ?? "Unknown work"}
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
                workTitle={titles[b.work_id] ?? "Unknown work"}
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
  workTitle,
  onDeliver,
}: {
  bounty: Bounty;
  workTitle: string;
  onDeliver: () => void;
}) {
  const b = bounty;
  const royalty = b.revenue_percent != null ? ` · ${b.revenue_percent}% royalty` : "";
  return (
    <div className="card flex items-center justify-between gap-4 py-3">
      <BountyMeta workTitle={workTitle} bounty={b} />
      <div className="flex shrink-0 items-center gap-2">
        {b.status === "claimed" && (
          <button className="btn-ghost px-4 py-1.5 text-sm" onClick={onDeliver}>
            Deliver
          </button>
        )}
        {b.status === "delivered" && <BountyStatusPill status="delivered" label="in review" />}
        {b.status === "approved" && <BountyStatusPill status="approved" label="minting…" />}
        {b.status === "minted" && (
          <>
            <BountyStatusPill status="minted" label="paid" />
            {b.tx_hash ? (
              <TxLink hash={b.tx_hash}>
                token #{b.token_id}
                {royalty} ↗
              </TxLink>
            ) : (
              <span className="rf-data text-xs text-t3">
                token #{b.token_id}
                {royalty}
              </span>
            )}
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
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<null | "uploading" | "saving">(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setError(null);
    try {
      setStep("uploading");
      const { path } = await apiUpload(file);
      setStep("saving");
      await apiPost(`/api/bounties/${bounty.id}/deliver`, {
        wallet,
        deliveryPath: path,
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
          Upload your asset for <span className="text-t1">{bounty.title}</span>. It
          will be pinned to IPFS and minted to you when the producer approves.
        </p>
        <div>
          <label className="label" htmlFor="file">Asset image</label>
          <input
            id="file"
            className="input file:mr-3 file:rounded file:border-0 file:bg-surface-raised file:px-3 file:py-1 file:text-t1"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !file}>
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
