"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Work, Bounty, Sale } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api";
import { useIdentity, truncateAddress } from "@/lib/use-identity";
import { RequireWallet } from "@/components/require-wallet";
import { Metric } from "@/components/metric";
import { Spinner } from "@/components/spinner";
import { PendingButton } from "@/components/pending-button";
import { TxLink, Amount } from "@/components/data";

type Board = { work: Work; bounties: Bounty[] };

export default function StorePage({ params }: { params: { id: string } }) {
  return (
    <RequireWallet>
      <StoreInner workId={params.id} />
    </RequireWallet>
  );
}

function StoreInner({ workId }: { workId: string }) {
  const { address } = useIdentity();
  const [board, setBoard] = useState<Board | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [buying, setBuying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSales = useCallback(async () => {
    const { sales } = await apiGet<{ sales: Sale[] }>(`/api/sales?work=${workId}`);
    setSales(sales);
  }, [workId]);

  const load = useCallback(async () => {
    try {
      const [b] = await Promise.all([apiGet<Board>(`/api/works/${workId}`), loadSales()]);
      setBoard(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load store");
    } finally {
      setLoading(false);
    }
  }, [workId, loadSales]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-t3">
        <Spinner /> Loading store…
      </div>
    );
  }
  if (error || !board) {
    return <div className="card bg-danger-subtle text-danger">{error ?? "Not found"}</div>;
  }

  const { work, bounties } = board;

  if (work.status !== "sealed") {
    return (
      <div className="card">
        <p>This work isn&apos;t sealed yet — there&apos;s no release to buy from.</p>
        <Link href={`/work/${work.id}`} className="btn-primary mt-4">
          Back to board
        </Link>
      </div>
    );
  }

  const price = work.base_price_eth ?? 0;
  const copiesSold = sales.reduce((s, x) => s + x.quantity, 0);
  const totalRevenue = sales.reduce((s, x) => s + x.amount_eth, 0);
  const paidToCreators = totalRevenue * 0.97; // ~3% Rare Forge fee underneath

  async function buy() {
    if (buying) return;
    setBuying(true);
    setActionError(null);
    try {
      await apiPost("/api/sales/buy", { workId, recipient: address ?? undefined });
      await loadSales();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Buy failed");
    } finally {
      setBuying(false);
    }
  }

  return (
    <div>
      <Link href={`/work/${work.id}`} className="text-sm text-t3 hover:text-t1">
        ← {work.title}
      </Link>

      {/* Header */}
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="rf-display text-3xl">{work.title}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-t3">
            <span className="pill bg-verified-subtle text-verified">release live</span>
            <span className="rf-data">{price} ETH</span> per copy
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PendingButton
            pending={buying}
            pendingLabel="Buying copy…"
            onClick={buy}
            className="btn-primary shadow-glow-accent"
          >
            Buy copy ↗
          </PendingButton>
          {actionError && <span className="text-xs text-danger">{actionError}</span>}
        </div>
      </div>

      {/* Metrics */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Metric label="Copies sold" value={copiesSold} />
        <Metric label="Total revenue" value={`${totalRevenue.toFixed(4)} ETH`} />
        <Metric label="Paid to creators" value={`~${paidToCreators.toFixed(4)} ETH`} />
      </div>

      {/* External sale bridge */}
      <BridgeCallout work={work} bounties={bounties} onBridged={loadSales} />

      {/* Recent sales */}
      <section className="mt-8">
        <h2 className="rf-eyebrow mb-3">Recent sales</h2>
        {sales.length === 0 ? (
          <div className="card text-center text-t3">No sales yet.</div>
        ) : (
          <div className="space-y-2">
            {sales.map((s) => (
              <SaleRow key={s.id} sale={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  const external = sale.source === "bridged_external";
  return (
    <div className="card flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={`pill ${
            external ? "bg-info-subtle text-info" : "bg-verified-subtle text-verified"
          }`}
        >
          {external ? "external" : "on-chain"}
        </span>
        <span className="text-sm text-t2">
          {sale.quantity} copy · <Amount eth={sale.amount_eth} />
        </span>
      </div>
      {sale.tx_hash ? (
        <TxLink hash={sale.tx_hash} />
      ) : (
        <span className="text-xs text-t4">no tx</span>
      )}
    </div>
  );
}

/**
 * External-sale bridge (Mundo B). The Steam event is SIMULATED; the on-chain
 * split payout is REAL. The bridge lists a receipt token the signer controls, so
 * it needs a real receiptContract + receiptTokenId (FRONTEND_SPEC: do not
 * silently fake this). We pre-fill from the work's minted asset as a usable
 * receipt token, but the operator must confirm/replace it.
 */
function BridgeCallout({
  work,
  bounties,
  onBridged,
}: {
  work: Work;
  bounties: Bounty[];
  onBridged: () => void;
}) {
  const minted = bounties.filter((b) => b.status === "minted" && b.claimed_by);
  const participants = minted
    .filter((b) => (b.revenue_percent ?? 0) > 0)
    .map((b) => ({ address: b.claimed_by!, role: b.role, percent: b.revenue_percent! }));

  const [receiptContract, setReceiptContract] = useState(work.asset_contract ?? "");
  const [receiptTokenId, setReceiptTokenId] = useState(minted[0]?.token_id ?? "");
  const [priceEth, setPriceEth] = useState(String(work.base_price_eth ?? "0.0001"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function bridge() {
    if (pending) return;
    if (!receiptContract || !receiptTokenId) {
      setError("A receipt contract + token id is required (a token the signer owns).");
      return;
    }
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const r = await apiPost<{ txHash: string }>("/api/sales/bridge", {
        workId: work.id,
        receiptContract,
        receiptTokenId,
        priceEth,
        principalAddress: work.requester_addr,
        participants,
      });
      setDone(r.txHash);
      onBridged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bridge failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card bg-info-subtle">
      <h2 className="rf-display text-lg text-t1">Simulate an off-chain sale (Steam)</h2>
      <p className="mt-1 text-sm text-t2">
        The external event is simulated, but the on-chain split payout is{" "}
        <span className="text-info">real</span>. This lists a receipt token the
        signer controls and applies the same fair split.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Receipt contract</label>
          <input
            className="input rf-data text-xs"
            value={receiptContract}
            onChange={(e) => setReceiptContract(e.target.value)}
            disabled={pending}
          />
        </div>
        <div>
          <label className="label">Token id</label>
          <input
            className="input rf-data"
            value={receiptTokenId}
            onChange={(e) => setReceiptTokenId(e.target.value)}
            disabled={pending}
          />
        </div>
        <div>
          <label className="label">Price (ETH)</label>
          <input
            className="input rf-data"
            type="number"
            step="0.0001"
            value={priceEth}
            onChange={(e) => setPriceEth(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>

      <p className="mt-2 text-xs text-t3">
        Split: principal{" "}
        <span className="rf-data">{truncateAddress(work.requester_addr)}</span> +{" "}
        {participants.length} participant(s) + 3% fee. Requires a real receipt
        token minted ahead of time — it is not faked.
      </p>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {done && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-verified">
          Bridged ✓ <TxLink hash={done}>view tx ↗</TxLink>
        </p>
      )}

      <PendingButton
        pending={pending}
        pendingLabel="Bridging…"
        onClick={bridge}
        className="btn-ghost mt-4"
      >
        Simulate Steam sale
      </PendingButton>
    </div>
  );
}
