import { supabase, type Work, type Sale } from "../supabase";
import { mintCopy, createSplitListing, buildRevenueSplit, type Participant } from "../rare";
import type { ServiceResult } from "./bounties";

/**
 * SALES SERVICE LAYER
 *
 * Mundo A: a buyer mints a copy from the release; the split (set at seal time)
 *          pays creators + the 3% fee automatically on-chain.
 * Mundo B: an external sale (e.g. Steam) is bridged — the event is simulated,
 *          but the on-chain split payout is real.
 *
 * Same pattern: HTTP routes and the future MCP agent both call these.
 */

/** Buy a copy from the work's release (Mundo A). Records the sale. */
export async function buyCopy(opts: {
  workId: string;
  quantity?: number;
  recipient?: string;
}): Promise<ServiceResult<{ txHash: string; tokenIds: string[]; sale: Sale }>> {
  const { data: work, error: wErr } = await supabase
    .from("works")
    .select("*")
    .eq("id", opts.workId)
    .single();
  if (wErr || !work) return { ok: false, error: "Work not found" };
  const w = work as Work;
  if (w.status !== "sealed" || !w.work_contract) {
    return { ok: false, error: "Work is not sealed yet — no release to buy from" };
  }

  // ONCHAIN: mint a copy from the release (triggers the split payout).
  const mint = await mintCopy({
    contract: w.work_contract,
    quantity: opts.quantity ?? 1,
    recipient: opts.recipient,
  });
  if (!mint.ok || !mint.data) {
    return { ok: false, error: `Copy mint failed: ${mint.error ?? "unknown"}` };
  }

  const amount = (w.base_price_eth ?? 0) * (opts.quantity ?? 1);
  const { data: sale, error: sErr } = await supabase
    .from("sales")
    .insert({
      work_id: opts.workId,
      source: "onchain_release",
      quantity: opts.quantity ?? 1,
      amount_eth: amount,
      tx_hash: mint.data.txHash,
    })
    .select()
    .single();
  if (sErr) return { ok: false, error: "Sold on-chain but failed to record (check tx)" };

  return {
    ok: true,
    data: { txHash: mint.data.txHash, tokenIds: mint.data.tokenIds, sale: sale as Sale },
  };
}

/**
 * Bridge an external sale (Mundo B). The external event (a Steam purchase) is
 * simulated by the caller; this fires a REAL on-chain split listing so the
 * creators + fee get paid for that external sale.
 *
 * NOTE: `listing create` lists a specific token, so the bridge needs a receipt
 * token id on a contract it controls. For the MVP the caller passes the
 * receipt contract + token id (minted ahead of time, as the validation showed).
 *
 * This is the function the MCP agent will call when it detects an external
 * sale — same logic, agent instead of a mock button.
 */
export async function bridgeExternalSale(opts: {
  workId: string;
  receiptContract: string;
  receiptTokenId: string;
  priceEth: string;
  principalAddress: string;
  participants: Participant[];
}): Promise<ServiceResult<{ txHash: string; sale: Sale }>> {
  // Build the same fair split used at seal time (creators + 3% fee), then
  // consolidate happens inside buildRevenueSplit.
  const { splits } = buildRevenueSplit({
    principalAddress: opts.principalAddress,
    participants: opts.participants,
  });

  // ONCHAIN: list the receipt token with the split. (A buyer then completes it;
  // in the demo the same actor buys it to show the payout.)
  const listing = await createSplitListing({
    contract: opts.receiptContract,
    tokenId: opts.receiptTokenId,
    priceEth: opts.priceEth,
    splits,
  });
  if (!listing.ok || !listing.data) {
    return { ok: false, error: `Bridge listing failed: ${listing.error ?? "unknown"}` };
  }

  const { data: sale, error: sErr } = await supabase
    .from("sales")
    .insert({
      work_id: opts.workId,
      source: "bridged_external",
      quantity: 1,
      amount_eth: Number(opts.priceEth),
      tx_hash: (listing.data as { txHash?: string }).txHash ?? null,
    })
    .select()
    .single();
  if (sErr) return { ok: false, error: "Bridged on-chain but failed to record (check tx)" };

  return {
    ok: true,
    data: { txHash: (listing.data as { txHash?: string }).txHash ?? "", sale: sale as Sale },
  };
}

/** List sales for a work (monitoring dashboard). */
export async function listSales(workId: string): Promise<ServiceResult<Sale[]>> {
  const { data, error } = await supabase
    .from("sales")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Sale[] };
}
