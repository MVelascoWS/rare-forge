import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Windows installs the CLI as rare.cmd. Node (>=18.20/20.12/22) refuses to run
// .cmd/.bat through execFile without shell:true (it throws EINVAL), and a bare
// "rare" with execFile throws "spawn rare ENOENT". So on win32 we run the
// command line through a shell — which resolves the .cmd extension — and quote
// every argument ourselves (the shell would otherwise split on spaces). This
// mirrors the approach proven in validate-onchain-windows.mjs.
const USE_SHELL = process.platform === "win32";

function quoteArg(arg: string): string {
  const s = String(arg);
  if (/[\s"&|<>^()]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Thin wrapper around the Rare Protocol CLI (@rareprotocol/rare-cli).
 *
 * Design notes:
 * - Every command below was verified against `rare <cmd> --help` on v1.2.2.
 * - We always pass the global `--json` flag so we get structured, parseable output.
 * - The signing wallet's private key lives ONLY in the backend env (RARE_PRIVATE_KEY).
 *   It must never reach the client or the repo.
 * - We target Sepolia (Ethereum) — chain id 11155111 — which is the network the
 *   RareMinter release commands support (configure/mint are mainnet + sepolia only).
 */

const CHAIN = "sepolia";
const CHAIN_ID = "11155111";

// Resolve the CLI binary. In the deployed app this is the locally installed
// @rareprotocol/rare-cli. Using the bin directly avoids npx overhead per call.
const RARE_BIN = process.env.RARE_BIN ?? "rare";

type RareResult<T = unknown> = {
  ok: boolean;
  data?: T;
  raw: string;
  error?: string;
};

/**
 * Response shapes confirmed against real Sepolia transactions during the
 * onchain validation run. These are the actual field names the CLI emits with
 * --json, so the app can read them directly without guessing.
 */
export type DeployResult = {
  txHash: string;
  blockNumber: string;
  contract: string;
  factory?: string;
  contractType?: string;
  nextStep?: string;
};

export type MintResult = {
  txHash: string;
  blockNumber: string;
  tokenId: string;
  contract: string;
  tokenUri: string; // ipfs://... — the CLI pins the image + metadata for us
};

export type RoyaltyStatus = {
  chain: string;
  contract: string;
  tokenId: string;
  receiver: string; // the creator — proof-of-authorship
  royaltyAmount: string;
  defaultReceiver: string;
  defaultPercentage: string;
};

export type ReleaseConfigResult = {
  txHash: string;
  rareMinter: string;
  contract: string;
  currencyAddress: string;
  price: string; // in wei
  startTime: string;
  maxMints: string;
  splitRecipients: string[];
  splitRatios: number[];
};

export type ReleaseStatus = {
  contract: string;
  configured: boolean;
  seller: string;
  price: string;
  splitRecipients: string[];
  splitRatios: number[];
  totalSupply: string;
  maxSupply: string;
  remainingSupply: string;
  soldOut: boolean;
  started: boolean;
  currentlyMintable: boolean;
  isEth: boolean;
};

export type CopyMintResult = {
  txHash: string;
  blockNumber: string;
  rareMinter: string;
  contract: string;
  buyer: string;
  recipient: string;
  quantity: number;
  totalPrice: string;
  requiredPayment: string; // totalPrice + protocol fee
  tokenIds: string[];
};

/**
 * Run a rare-cli command with --json and parse the result.
 * `args` must NOT include --json or --chain; we append those here so callers
 * can't accidentally omit them.
 */
async function runRare<T = unknown>(args: string[]): Promise<RareResult<T>> {
  const fullArgs = [...args, "--chain", CHAIN, "--chain-id", CHAIN_ID, "--json"];

  try {
    const execOpts = {
      env: {
        ...process.env,
        // The CLI reads the configured private key; we keep it in env only.
      },
      maxBuffer: 1024 * 1024 * 8,
      timeout: 120_000,
    };
    const { stdout } = USE_SHELL
      ? await execAsync(
          [RARE_BIN, ...fullArgs].map(quoteArg).join(" "),
          { ...execOpts, windowsHide: true }
        )
      : await execFileAsync(RARE_BIN, fullArgs, execOpts);

    const raw = stdout.trim();
    try {
      return { ok: true, data: JSON.parse(raw) as T, raw };
    } catch {
      // Some commands may emit non-JSON lines before the JSON payload;
      // attempt to recover the last JSON object/array in the output.
      const recovered = extractLastJson(raw);
      if (recovered !== null) {
        return { ok: true, data: recovered as T, raw };
      }
      return { ok: true, raw };
    }
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    return {
      ok: false,
      raw: e.stderr ?? "",
      error: e.stderr?.trim() || e.message || "rare-cli execution failed",
    };
  }
}

function extractLastJson(text: string): unknown | null {
  // Walk backwards to find the last balanced JSON object or array.
  const lastBrace = Math.max(text.lastIndexOf("{"), text.lastIndexOf("["));
  if (lastBrace === -1) return null;
  for (let start = lastBrace; start >= 0; start--) {
    const ch = text[start];
    if (ch !== "{" && ch !== "[") continue;
    const slice = text.slice(start);
    try {
      return JSON.parse(slice);
    } catch {
      // keep scanning
    }
  }
  return null;
}

/** A payout split entry: a wallet address and its integer ratio (must sum to 100). */
export type SplitEntry = { address: string; ratio: number };

// ---------------------------------------------------------------------------
// RARE FORGE BUSINESS MODEL
//
// Revenue: a percentage fee per copy sale, taken automatically on-chain as one
// more recipient in the same --split mechanism validated on Sepolia. No manual
// collection, no separate contract.
//
// Default fee: 3%. Deliberately low — the whole pitch is "fair to creators"
// vs Steam/App Store's 30%. This sits alongside Rare Protocol's own ~3%
// marketplace fee (seen in validation: a 0.0001 ETH copy cost 0.000103 ETH).
// Total platform take stays ~6%, a fraction of traditional 30%.
//
// The creator chooses who absorbs the fee (set at seal time):
//   - "absorb": fee comes OUT of the published price (creators net a bit less).
//   - "passthrough": price is raised by the fee % so creators keep their full
//     share and the buyer covers the fee.
//
// IMPORTANT — integer-ratio constraint: the validated --split used integers
// (50, 50). With a 3% fee and 2 equal creators, naive math gives 48.5 each,
// which is fractional. Until we confirm the CLI accepts fractional ratios,
// keep splits integer by design (see buildFeeSplit below). VERIFY THIS on-chain
// before relying on fractional ratios.
// ---------------------------------------------------------------------------

export const RARE_FORGE_FEE_PERCENT = 3;

// Fixed protocol fee wallet for the MVP. Set via env; falls back to a
// placeholder that MUST be replaced before any real sale.
export const RARE_FORGE_FEE_WALLET =
  process.env.RARE_FORGE_FEE_WALLET ?? "0xFEE_WALLET_NOT_SET";

export type FeeMode = "absorb" | "passthrough";

function buildSplitArgs(splits: SplitEntry[]): string[] {
  const total = splits.reduce((s, x) => s + x.ratio, 0);
  if (total !== 100) {
    throw new Error(`Split ratios must sum to 100, got ${total}`);
  }
  if (splits.some((s) => !Number.isInteger(s.ratio))) {
    throw new Error(
      `Split ratios must be integers (CLI constraint). Got: ${splits
        .map((s) => s.ratio)
        .join(", ")}`
    );
  }
  return splits.flatMap((s) => ["--split", `${s.address}=${s.ratio}`]);
}

/**
 * Build the final split array including the Rare Forge fee, keeping all ratios
 * integers. `creatorShares` are the creators' relative shares of the
 * post-fee pot (they need not sum to 100 themselves — we normalize).
 *
 * In "absorb" mode the fee is carved out of 100, leaving (100 - fee) to split
 * among creators. In "passthrough" mode the on-chain split is the SAME (the fee
 * still appears as a recipient); the difference is handled by raising --price
 * (see priceWithFee), so creators' effective take on the base price is whole.
 */
export function buildFeeSplit(
  creators: { address: string; weight: number }[],
  feePercent: number = RARE_FORGE_FEE_PERCENT,
  feeWallet: string = RARE_FORGE_FEE_WALLET
): SplitEntry[] {
  const creatorPot = 100 - feePercent;
  const totalWeight = creators.reduce((s, c) => s + c.weight, 0);
  if (totalWeight <= 0) throw new Error("Creator weights must be positive");

  // Distribute creatorPot across creators as integers, giving any rounding
  // remainder to the first creator so the whole thing sums to exactly 100.
  const raw = creators.map((c) => (c.weight / totalWeight) * creatorPot);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = creatorPot - floored.reduce((s, x) => s + x, 0);
  const ratios = [...floored];
  for (let i = 0; remainder > 0; i = (i + 1) % ratios.length, remainder--) {
    ratios[i] += 1;
  }

  const entries: SplitEntry[] = creators.map((c, i) => ({
    address: c.address,
    ratio: ratios[i],
  }));
  entries.push({ address: feeWallet, ratio: feePercent });
  return entries;
}

/** A participant in the work: a contributor with a percentage the principal assigns. */
export type Participant = {
  address: string;
  role?: string; // "concept_artist", "modeler", "animator", "musician"...
  percent: number; // % of the work the principal grants this participant
};

/**
 * REVENUE SPLIT MODEL (Rare Forge)
 *
 * The principal creator (the one who opened the work) assigns a percentage to
 * each participant. The principal keeps WHATEVER REMAINS automatically — they
 * don't fix their own number. The participants' percentages are "of the work"
 * as creators think of it (a 0–100 mental model); the 3% Rare Forge fee is
 * inserted UNDERNEATH, transparently, by scaling everything into the (100-fee)%
 * creator pot.
 *
 * Example — principal + {concept 5, modeler 5, animator 5, musician 3}:
 *   participants take 18% of the work, principal keeps 82% (the remainder),
 *   then the whole creator side is scaled to fit 97% (fee = 3%).
 *
 * All on-chain ratios are integers summing to exactly 100. Rounding remainder
 * goes to the PRINCIPAL (they're the natural absorber of fractions).
 */
export function buildRevenueSplit(opts: {
  principalAddress: string;
  participants: Participant[];
  feePercent?: number;
  feeWallet?: string;
}): { splits: SplitEntry[]; breakdown: { address: string; role: string; percentOfWork: number; onchainRatio: number }[] } {
  const feePercent = opts.feePercent ?? RARE_FORGE_FEE_PERCENT;
  const feeWallet = opts.feeWallet ?? RARE_FORGE_FEE_WALLET;

  const participantTotal = opts.participants.reduce((s, p) => s + p.percent, 0);
  if (participantTotal < 0) throw new Error("Participant percentages cannot be negative");
  if (participantTotal > 100) {
    throw new Error(
      `Participants were assigned ${participantTotal}% — more than 100%. ` +
        `Reduce assignments so the principal keeps a non-negative remainder.`
    );
  }

  // The principal keeps the remainder of the 0–100 "of the work" mental model.
  const principalPercent = 100 - participantTotal;

  // Everyone on the creator side, expressed in the 0–100 mental model.
  const creatorSide: { address: string; role: string; percentOfWork: number }[] = [
    { address: opts.principalAddress, role: "principal", percentOfWork: principalPercent },
    ...opts.participants.map((p) => ({
      address: p.address,
      role: p.role ?? "participant",
      percentOfWork: p.percent,
    })),
  ];

  // Insert the fee underneath: scale the creator side into the (100 - fee)% pot.
  const creatorPot = 100 - feePercent;
  const raw = creatorSide.map((c) => (c.percentOfWork / 100) * creatorPot);
  const ratios = raw.map((r) => Math.floor(r));
  // A participant with a small share (e.g. 1% of the work) scales below 1 and
  // floors to 0. The CLI rejects a 0 ratio, and a contributor shouldn't silently
  // earn nothing — so any creator with a positive assigned share gets at least 1%.
  for (let i = 1; i < ratios.length; i++) {
    if (creatorSide[i].percentOfWork > 0 && ratios[i] === 0) ratios[i] = 1;
  }
  // The principal keeps whatever remains: creatorPot minus the participants'
  // ratios (this also absorbs rounding, as before).
  const participantsUsed = ratios.slice(1).reduce((s, x) => s + x, 0);
  ratios[0] = creatorPot - participantsUsed;
  if (ratios[0] < 0) {
    throw new Error(
      "Too many sub-1% participant shares to seal — increase shares or reduce participants."
    );
  }

  const splitsByRole: SplitEntry[] = creatorSide.map((c, i) => ({
    address: c.address,
    ratio: ratios[i],
  }));
  splitsByRole.push({ address: feeWallet, ratio: feePercent });

  const breakdown = creatorSide.map((c, i) => ({
    address: c.address,
    role: c.role,
    percentOfWork: c.percentOfWork,
    onchainRatio: ratios[i],
  }));
  breakdown.push({ address: feeWallet, role: "rare_forge_fee", percentOfWork: feePercent, onchainRatio: feePercent });

  // Consolidate by unique address for the on-chain split. The CLI rejects
  // duplicate split addresses, so if the same wallet holds multiple roles
  // (e.g. principal is also the musician, or the fee wallet equals a creator),
  // we sum their ratios into a single entry. The role-level breakdown above is
  // kept intact for display.
  const consolidated = new Map<string, number>();
  for (const s of splitsByRole) {
    const key = s.address.toLowerCase();
    consolidated.set(key, (consolidated.get(key) ?? 0) + s.ratio);
  }
  // Preserve original casing of the first occurrence of each address.
  const casing = new Map<string, string>();
  for (const s of splitsByRole) {
    const key = s.address.toLowerCase();
    if (!casing.has(key)) casing.set(key, s.address);
  }
  const splits: SplitEntry[] = [...consolidated.entries()]
    .map(([key, ratio]) => ({ address: casing.get(key)!, ratio }))
    // Drop any 0-ratio entry (e.g. a principal who assigned 100% to others) —
    // the CLI requires every split ratio to be between 1 and 100.
    .filter((s) => s.ratio > 0);

  // Sanity: ratios must be integers summing to exactly 100.
  const sum = splits.reduce((s, x) => s + x.ratio, 0);
  if (sum !== 100) {
    throw new Error(`Internal error: split ratios sum to ${sum}, expected 100`);
  }

  return { splits, breakdown };
}

/**
 * Compute the on-chain --price for a desired creator-facing base price.
 * - absorb: price stays the base price (fee comes out of the split).
 * - passthrough: price is raised so the post-fee creator pot equals the base.
 */
export function priceWithFee(
  basePriceEth: number,
  mode: FeeMode,
  feePercent: number = RARE_FORGE_FEE_PERCENT
): string {
  if (mode === "absorb") return String(basePriceEth);
  // passthrough: gross the price up so the (100 - fee)% creator pot == base.
  const gross = basePriceEth / (1 - feePercent / 100);
  return gross.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

// ---------------------------------------------------------------------------
// ARCHITECTURE NOTE — two collection types, discovered during onchain validation:
//
//   1. ASSET collection: `deploy erc721` (normal). Individual creator assets are
//      minted directly here via `collection mint`, each with its creator as the
//      ERC-2981 royalty receiver. Proof-of-authorship per asset.
//
//   2. WORK collection: `deploy lazy-erc721`. The finished work is sold as copies
//      through a RareMinter release. Copies are NOT minted one-by-one up front —
//      they're prepared in a batch (`prepare-lazy-mint`) and minted on purchase.
//      A direct `collection mint` on a lazy contract reverts (mintTo reverts) —
//      that's by design; lazy contracts only mint through the release flow.
//
// Collection: deploy + mint. Verified: `collection deploy erc721`,
// `collection deploy lazy-erc721`, `collection mint`, `collection prepare-lazy-mint`.
// ---------------------------------------------------------------------------

/** Deploy the ASSET collection (normal erc721) — for minting individual creator assets. */
export async function deployAssetCollection(opts: {
  name: string;
  symbol: string;
  maxTokens: number;
}): Promise<RareResult<DeployResult>> {
  return runRare([
    "collection",
    "deploy",
    "erc721",
    opts.name,
    opts.symbol,
    "--max-tokens",
    String(opts.maxTokens),
  ]);
}

/** Deploy the WORK collection (lazy-erc721) — required for the copy-sale release. */
export async function deployWorkCollection(opts: {
  name: string;
  symbol: string;
  maxTokens: number;
  contractType?: "lazy" | "lazy-royalty-guard" | "lazy-deadman-royalty-guard";
}): Promise<RareResult<DeployResult>> {
  const typeArgs = opts.contractType
    ? ["--contract-type", opts.contractType]
    : ["--contract-type", "lazy"];
  return runRare([
    "collection",
    "deploy",
    "lazy-erc721",
    opts.name,
    opts.symbol,
    "--max-tokens",
    String(opts.maxTokens),
    ...typeArgs,
  ]);
}

/**
 * Prepare the lazy mint batch on the WORK collection and approve RareMinter as
 * the minter. Must run before `configureRelease`. The deploy step's nextStep
 * field spells this out: "Prepare lazy mint metadata, approve RareMinter, then
 * Configure release sale and mint settings."
 */
export async function prepareLazyMint(opts: {
  contract: string;
  baseUri: string;
  amount: number;
}) {
  return runRare([
    "collection",
    "prepare-lazy-mint",
    "--contract",
    opts.contract,
    "--base-uri",
    opts.baseUri,
    "--amount",
    String(opts.amount),
    "--minter",
    "rare-minter",
  ]);
}

/**
 * Mint a single asset NFT. The creator is recorded as the on-chain royalty
 * receiver (ERC-2981) — this is the per-asset proof-of-authorship.
 */
export async function mintAsset(opts: {
  contract: string;
  name: string;
  description: string;
  imagePath: string;
  creatorAddress: string; // becomes --royalty-receiver
  attributes?: { trait: string; value: string }[];
}): Promise<RareResult<MintResult>> {
  const attrArgs = (opts.attributes ?? []).flatMap((a) => [
    "--attribute",
    `${a.trait}=${a.value}`,
  ]);

  return runRare([
    "collection",
    "mint",
    "--contract",
    opts.contract,
    "--name",
    opts.name,
    "--description",
    opts.description,
    "--image",
    opts.imagePath,
    "--royalty-receiver",
    opts.creatorAddress,
    "--to",
    opts.creatorAddress,
    ...attrArgs,
  ]);
}

/**
 * Mint the FINAL work NFT. Its metadata references the child asset token IDs
 * (composable provenance) via repeatable --attribute entries.
 */
export async function mintFinalWork(opts: {
  contract: string;
  name: string;
  description: string;
  imagePath: string;
  childTokenIds: string[];
  creatorAddress: string;
}) {
  const provenanceArgs = opts.childTokenIds.flatMap((id) => [
    "--attribute",
    `component_token=${id}`,
  ]);

  return runRare([
    "collection",
    "mint",
    "--contract",
    opts.contract,
    "--name",
    opts.name,
    "--description",
    opts.description,
    "--image",
    opts.imagePath,
    "--royalty-receiver",
    opts.creatorAddress,
    ...provenanceArgs,
  ]);
}

// ---------------------------------------------------------------------------
// RareMinter release: the "store" where copies are sold, with the fair split
// baked in at configuration time. Verified: `rare listing release configure`,
// `rare listing release mint`, `rare listing release limits`.
// ---------------------------------------------------------------------------

/**
 * Seal the work as a direct-sale release. The --split set here applies to
 * EVERY copy minted from this release — this is the recurring fair-royalty core.
 */
export async function configureRelease(opts: {
  contract: string;
  pricePerMintEth: string;
  splits: SplitEntry[];
  currency?: "eth" | "usdc" | "rare";
  maxMintsPerTx?: number;
}): Promise<RareResult<ReleaseConfigResult>> {
  return runRare([
    "listing",
    "release",
    "configure",
    "--contract",
    opts.contract,
    "--price",
    opts.pricePerMintEth,
    "--currency",
    opts.currency ?? "eth",
    "--max-mints",
    String(opts.maxMintsPerTx ?? 0),
    ...buildSplitArgs(opts.splits),
    "--yes",
  ]);
}

/**
 * High-level seal: configure the copy-sale release using the principal +
 * participants revenue model, applying the Rare Forge fee and the creator's
 * chosen fee mode. This is what the "seal work" screen calls.
 *
 * - basePriceEth: the creator-facing price per copy.
 * - principalAddress: the principal creator (keeps the remainder).
 * - participants: contributors and the % of the work the principal grants each.
 * - feeMode: "absorb" (fee out of price) or "passthrough" (price grossed up).
 *
 * Returns the release result plus the human-readable split breakdown so the UI
 * can show exactly how each sale will be divided.
 */
export async function sealWork(opts: {
  contract: string;
  basePriceEth: number;
  principalAddress: string;
  participants: Participant[];
  feeMode: FeeMode;
  currency?: "eth" | "usdc" | "rare";
  maxMintsPerTx?: number;
}): Promise<RareResult<ReleaseConfigResult> & { breakdown?: ReturnType<typeof buildRevenueSplit>["breakdown"] }> {
  const { splits, breakdown } = buildRevenueSplit({
    principalAddress: opts.principalAddress,
    participants: opts.participants,
  });
  const price = priceWithFee(opts.basePriceEth, opts.feeMode);
  const result = await configureRelease({
    contract: opts.contract,
    pricePerMintEth: price,
    splits,
    currency: opts.currency,
    maxMintsPerTx: opts.maxMintsPerTx,
  });
  return { ...result, breakdown };
}

/** Buy/mint a copy from the configured release. Each call = one on-chain sale. */
export async function mintCopy(opts: {
  contract: string;
  quantity: number;
  recipient?: string;
}): Promise<RareResult<CopyMintResult>> {
  const recipientArgs = opts.recipient
    ? ["--recipient", opts.recipient]
    : [];
  return runRare([
    "listing",
    "release",
    "mint",
    "--contract",
    opts.contract,
    "--quantity",
    String(opts.quantity),
    ...recipientArgs,
    "--yes",
  ]);
}

// ---------------------------------------------------------------------------
// Listing with split: used by the "external sale bridge" (Mundo B). The event
// that triggers this is simulated; the on-chain split payout is real.
// Verified: `rare listing create --split`.
// ---------------------------------------------------------------------------

export async function createSplitListing(opts: {
  contract: string;
  tokenId: string;
  priceEth: string;
  splits: SplitEntry[];
}) {
  return runRare([
    "listing",
    "create",
    "--contract",
    opts.contract,
    "--token-id",
    opts.tokenId,
    "--price",
    opts.priceEth,
    ...buildSplitArgs(opts.splits),
    "--yes",
  ]);
}

// ---------------------------------------------------------------------------
// Read-only helpers. Verified: `rare collection royalty status`,
// `rare listing release status`, `rare wallet address`.
// ---------------------------------------------------------------------------

export async function readRoyaltyStatus(contract: string, tokenId: string) {
  return runRare([
    "collection",
    "royalty",
    "status",
    "--contract",
    contract,
    "--token-id",
    tokenId,
  ]);
}

export async function readReleaseStatus(contract: string) {
  return runRare(["listing", "release", "status", "--contract", contract]);
}

export async function walletAddress() {
  return runRare(["wallet", "address"]);
}

export { CHAIN, CHAIN_ID };
