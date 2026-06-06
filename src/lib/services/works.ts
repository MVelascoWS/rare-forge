import { supabase, type Work, type Bounty, type FeeMode } from "../supabase";
import {
  deployAssetCollection,
  deployWorkCollection,
  prepareLazyMint,
  sealWork as sealWorkOnchain,
  type Participant,
} from "../rare";
import type { ServiceResult } from "./bounties";

/**
 * WORK SERVICE LAYER
 *
 * Pure action functions for the requester (principal creator) flow. Same
 * pattern as bounties: HTTP routes and the future MCP agent both call these.
 */

/**
 * Create a work and deploy its ASSET collection (erc721). The asset contract
 * is where individual creator assets get minted. (Requester step 1.)
 */
export async function createWork(opts: {
  title: string;
  description?: string;
  requesterAddr: string;
}): Promise<ServiceResult<Work>> {
  // ONCHAIN: deploy the asset collection.
  const deploy = await deployAssetCollection({
    name: opts.title.slice(0, 30) || "Rare Forge Work",
    symbol: "RFA",
    maxTokens: 1000,
  });
  if (!deploy.ok || !deploy.data) {
    return { ok: false, error: `Asset collection deploy failed: ${deploy.error ?? "unknown"}` };
  }

  const { data, error } = await supabase
    .from("works")
    .insert({
      title: opts.title,
      description: opts.description ?? null,
      requester_addr: opts.requesterAddr,
      asset_contract: deploy.data.contract,
      status: "open",
    })
    .select()
    .single();

  if (error) return { ok: false, error: `Deployed on-chain but failed to record: ${error.message}` };
  return { ok: true, data: data as Work };
}

/** Open a bounty within a work. (Requester step 2.) */
export async function openBounty(opts: {
  workId: string;
  title: string;
  role: string;
  rewardEth: number;
  revenuePercent?: number;
  instructions?: string;
  deliverableSpecs?: string;
  referencePath?: string;
}): Promise<ServiceResult<Bounty>> {
  const insert: Record<string, unknown> = {
    work_id: opts.workId,
    title: opts.title,
    role: opts.role,
    reward_eth: opts.rewardEth,
    revenue_percent: opts.revenuePercent ?? null,
    status: "open",
  };
  // Only reference the brief columns when a value is provided, so opening a
  // bounty without a brief keeps working before the migration is applied.
  if (opts.instructions !== undefined) insert.instructions = opts.instructions;
  if (opts.deliverableSpecs !== undefined) insert.deliverable_specs = opts.deliverableSpecs;
  if (opts.referencePath !== undefined) insert.reference_path = opts.referencePath;

  const { data, error } = await supabase
    .from("bounties")
    .insert(insert)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Bounty };
}

/** Get a work with its bounties (for the bounty board screen). */
export async function getWorkWithBounties(
  workId: string
): Promise<ServiceResult<{ work: Work; bounties: Bounty[] }>> {
  const { data: work, error: wErr } = await supabase
    .from("works")
    .select("*")
    .eq("id", workId)
    .single();
  if (wErr || !work) return { ok: false, error: "Work not found" };

  const { data: bounties, error: bErr } = await supabase
    .from("bounties")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: true });
  if (bErr) return { ok: false, error: bErr.message };

  return { ok: true, data: { work: work as Work, bounties: (bounties ?? []) as Bounty[] } };
}

/** List all works (gallery / requester dashboard). */
export async function listWorks(): Promise<ServiceResult<Work[]>> {
  const { data, error } = await supabase
    .from("works")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Work[] };
}

/**
 * Seal the work: deploy the lazy collection, prepare the lazy mint + approve
 * RareMinter, then configure the copy-sale release with the fair revenue split
 * (principal + participants + 3% Rare Forge fee). (Requester steps 5–6.)
 *
 * The participants come from the minted bounties' revenue_percent values; the
 * principal is the work's requester and keeps the remainder.
 */
export async function sealWork(opts: {
  workId: string;
  basePriceEth: number;
  feeMode: FeeMode;
  imagePath: string; // cover/base image for the work release
}): Promise<ServiceResult<{ work: Work; breakdown: unknown }>> {
  const { data: work, error: wErr } = await supabase
    .from("works")
    .select("*")
    .eq("id", opts.workId)
    .single();
  if (wErr || !work) return { ok: false, error: "Work not found" };
  const w = work as Work;
  if (w.status === "sealed") return { ok: false, error: "Work is already sealed" };

  // Gather minted bounties to build the participant list.
  const { data: bounties } = await supabase
    .from("bounties")
    .select("*")
    .eq("work_id", opts.workId)
    .eq("status", "minted");

  const participants: Participant[] = ((bounties ?? []) as Bounty[])
    .filter((b) => b.claimed_by && b.revenue_percent && b.revenue_percent > 0)
    .map((b) => ({
      address: b.claimed_by!,
      role: b.role,
      percent: b.revenue_percent!,
    }));

  // ONCHAIN 1: deploy the lazy work collection.
  const deployWork = await deployWorkCollection({
    name: w.title.slice(0, 30) || "Rare Forge Release",
    symbol: "RFW",
    maxTokens: 1000,
    contractType: "lazy",
  });
  if (!deployWork.ok || !deployWork.data) {
    return { ok: false, error: `Work collection deploy failed: ${deployWork.error ?? "unknown"}` };
  }
  const workContract = deployWork.data.contract;

  // ONCHAIN 2: prepare lazy mint batch + approve RareMinter.
  const prep = await prepareLazyMint({
    contract: workContract,
    baseUri: `ipfs://rare-forge/${opts.workId}/`,
    amount: 1000,
  });
  if (!prep.ok) {
    return { ok: false, error: `Prepare lazy mint failed: ${prep.error ?? "unknown"}` };
  }

  // ONCHAIN 3: configure the release with the fair split.
  const seal = await sealWorkOnchain({
    contract: workContract,
    basePriceEth: opts.basePriceEth,
    principalAddress: w.requester_addr,
    participants,
    feeMode: opts.feeMode,
  });
  if (!seal.ok || !seal.data) {
    return { ok: false, error: `Seal (release configure) failed: ${seal.error ?? "unknown"}` };
  }

  // Record the sealed state.
  const { data: updated, error: updErr } = await supabase
    .from("works")
    .update({
      status: "sealed",
      work_contract: workContract,
      base_price_eth: opts.basePriceEth,
      fee_mode: opts.feeMode,
      seal_tx_hash: seal.data.txHash,
    })
    .eq("id", opts.workId)
    .select()
    .single();

  if (updErr) return { ok: false, error: "Sealed on-chain but failed to record (check tx)" };
  return { ok: true, data: { work: updated as Work, breakdown: seal.breakdown } };
}
