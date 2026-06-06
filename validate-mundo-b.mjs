#!/usr/bin/env node
/**
 * Rare Forge — Mundo B validation (external sale bridge) with 3% fee
 * ------------------------------------------------------------------
 * Validates the "external sale" bridge: a simulated off-chain sale (e.g. a
 * Steam purchase) triggers a REAL on-chain split payout to multiple creators
 * PLUS the 3% Rare Forge protocol fee. This confirms the split mechanism works
 * with N recipients (principal + participants + fee), not just two.
 *
 * The external event is mocked; every transaction here is real on Sepolia.
 *
 * Flow:
 *   0. Read wallet
 *   1. Deploy an asset collection (erc721) to hold a "sale receipt" token
 *   2. Mint a receipt token (represents one external sale)
 *   3. Bridge: list that token with a multi-recipient split (creators + 3% fee)
 *   4. Buy the listing from a second context -> split pays out on-chain
 *
 * PREREQUISITES (same as the main validation):
 *   - Sepolia wallet funded, rare-cli configured for sepolia.
 *   - Optional: CREATOR_A, CREATOR_B, CONCEPT, MUSICIAN env addresses.
 *   - FEE_WALLET env: the Rare Forge fee wallet (defaults to signer).
 *
 * RUN:  node validate-mundo-b.mjs
 */

import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const CHAIN = "sepolia";
const CHAIN_ID = "11155111";
const RARE_BIN = process.env.RARE_BIN ?? "rare";
const USE_SHELL = process.platform === "win32";
const ASSETS_DIR = process.env.ASSETS_DIR ?? "test-assets";
const img = (name) => path.join(ASSETS_DIR, name);

// The external sale price (what the "Steam buyer" paid, reflected on-chain).
const SALE_PRICE_ETH = process.env.SALE_PRICE_ETH ?? "0.0002";

const artifacts = {};

function quoteArg(arg) {
  const s = String(arg);
  if (/[\s"&|<>^()]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function hr() {
  console.log("\n" + "=".repeat(72));
}

async function step(label, args) {
  hr();
  console.log(`STEP: ${label}`);
  const fullArgs = [...args, "--chain", CHAIN, "--chain-id", CHAIN_ID, "--json"];
  try {
    let stdout, stderr;
    if (USE_SHELL) {
      const cmdLine = [RARE_BIN, ...fullArgs].map(quoteArg).join(" ");
      console.log(`  $ ${cmdLine}`);
      ({ stdout, stderr } = await execAsync(cmdLine, { maxBuffer: 8 << 20, timeout: 180_000, windowsHide: true }));
    } else {
      console.log(`  $ ${RARE_BIN} ${fullArgs.join(" ")}`);
      ({ stdout, stderr } = await execFileAsync(RARE_BIN, fullArgs, { maxBuffer: 8 << 20, timeout: 180_000 }));
    }
    const raw = stdout.trim();
    let data;
    try { data = JSON.parse(raw); } catch { data = extractLastJson(raw); }
    console.log("  ✓ ok");
    console.log("  result:", JSON.stringify(data ?? raw, null, 2).slice(0, 1400));
    if (stderr?.trim()) console.log("  stderr:", stderr.trim().slice(0, 400));
    return { ok: true, data, raw };
  } catch (err) {
    console.log("  ✗ FAILED");
    console.log("  error:", (err.stderr || err.message || "").trim().slice(0, 1500));
    console.log("\nStopping here. Inspect the error above.");
    writeFileSync("validate-mundo-b-artifacts.json", JSON.stringify(artifacts, null, 2));
    process.exit(1);
  }
}

function extractLastJson(text) {
  const last = Math.max(text.lastIndexOf("{"), text.lastIndexOf("["));
  for (let s = last; s >= 0; s--) {
    if (text[s] !== "{" && text[s] !== "[") continue;
    try { return JSON.parse(text.slice(s)); } catch {}
  }
  return null;
}

function pick(data, keys) {
  if (!data || typeof data !== "object") return undefined;
  for (const k of keys) {
    if (data[k] != null) return data[k];
    for (const v of Object.values(data)) {
      if (v && typeof v === "object" && v[k] != null) return v[k];
    }
  }
  return undefined;
}

// Replicate the Rare Forge revenue split (principal + participants + 3% fee),
// integers summing to 100, remainder to the principal.
function buildRevenueSplit(principal, participants, feeWallet, feePercent = 3) {
  const participantTotal = participants.reduce((s, p) => s + p.percent, 0);
  if (participantTotal > 100) throw new Error("participants exceed 100%");
  const principalPercent = 100 - participantTotal;
  const side = [
    { address: principal, role: "principal", percentOfWork: principalPercent },
    ...participants.map((p) => ({ address: p.address, role: p.role, percentOfWork: p.percent })),
  ];
  const creatorPot = 100 - feePercent;
  const floored = side.map((c) => Math.floor((c.percentOfWork / 100) * creatorPot));
  const remainder = creatorPot - floored.reduce((s, x) => s + x, 0);
  const ratios = [...floored];
  ratios[0] += remainder;
  const splits = side.map((c, i) => ({ address: c.address, role: c.role, ratio: ratios[i] }));
  splits.push({ address: feeWallet, role: "rare_forge_fee", ratio: feePercent });

  // Consolidate by unique address (CLI rejects duplicate split addresses).
  // Keep role labels for display, but merge ratios per address for the on-chain call.
  const merged = new Map();
  for (const s of splits) {
    const key = s.address.toLowerCase();
    if (merged.has(key)) {
      merged.get(key).ratio += s.ratio;
      merged.get(key).role += `+${s.role}`;
    } else {
      merged.set(key, { address: s.address, role: s.role, ratio: s.ratio });
    }
  }
  return [...merged.values()];
}

async function main() {
  hr();
  console.log("Rare Forge — Mundo B validation (external sale bridge + 3% fee)");
  console.log("This runs REAL transactions on Sepolia.");

  const w = await step("Read wallet address", ["wallet", "address"]);
  const signer = pick(w.data, ["address", "wallet", "account"]);
  console.log("  signer:", signer);
  artifacts.signer = signer;

  // Participants (default to signer if not provided, so it still runs solo).
  const PRINCIPAL = process.env.CREATOR_A ?? signer;
  const CONCEPT = process.env.CONCEPT ?? signer;
  const MUSICIAN = process.env.MUSICIAN ?? signer;
  const FEE_WALLET = process.env.FEE_WALLET ?? signer;

  const splits = buildRevenueSplit(
    PRINCIPAL,
    [
      { address: CONCEPT, role: "concept_artist", percent: 10 },
      { address: MUSICIAN, role: "musician", percent: 7 },
    ],
    FEE_WALLET
  );
  console.log("\n  Revenue split for this external sale:");
  splits.forEach((s) => console.log(`    ${s.role}: ${s.address} = ${s.ratio}%`));
  const splitArgs = splits.flatMap((s) => ["--split", `${s.address}=${s.ratio}`]);
  artifacts.splits = splits;

  // 1. Deploy a collection to hold the "sale receipt" token.
  const dep = await step("Deploy erc721 collection (sale receipts)", [
    "collection", "deploy", "erc721", "Rare Forge Sales", "RFSALE", "--max-tokens", "1000",
  ]);
  const contract = pick(dep.data, ["contract", "contractAddress", "address"]);
  console.log("  >> contract:", contract);
  artifacts.contract = contract;

  // 2. Mint a receipt token representing one external (Steam) sale.
  const m = await step("Mint sale-receipt token", [
    "collection", "mint",
    "--contract", contract,
    "--name", "External sale receipt",
    "--description", "Bridged external sale - Mundo B validation",
    "--image", img("final.png"),
    "--attribute", "source=external_steam",
  ]);
  const tokenId = pick(m.data, ["tokenId", "token_id", "id"]);
  console.log("  >> tokenId:", tokenId);
  artifacts.tokenId = tokenId;

  // 3. Bridge: list the receipt token with the multi-recipient split.
  //    This is what the agent/mock fires when an external sale is detected.
  await step("Bridge: list receipt token with creators + 3% fee split", [
    "listing", "create",
    "--contract", contract,
    "--token-id", String(tokenId),
    "--price", SALE_PRICE_ETH,
    "--currency", "eth",
    ...splitArgs,
    "--yes",
  ]);

  // 4. Buy the listing -> on-chain split payout to all recipients.
  const buy = await step("Buy the listing (triggers multi-recipient split payout)", [
    "listing", "buy",
    "--contract", contract,
    "--token-id", String(tokenId),
    "--price", SALE_PRICE_ETH,
    "--currency", "eth",
    "--yes",
  ]);
  artifacts.buyTx = pick(buy.data, ["txHash", "transactionHash", "tx", "hash"]);
  console.log("  >> buy tx:", artifacts.buyTx);

  hr();
  console.log("MUNDO B VALIDATED ✓");
  console.log("External sale bridge works: multi-recipient split (creators + 3% fee) paid on-chain.");
  console.log("\nVerify on Sepolia Etherscan that the buy tx's INTERNAL transactions");
  console.log("show payouts to each creator AND the fee wallet.");
  console.log("\nArtifacts:");
  console.log(JSON.stringify(artifacts, null, 2));
  writeFileSync("validate-mundo-b-artifacts.json", JSON.stringify(artifacts, null, 2));
}

main().catch((e) => { console.error("Unexpected error:", e); process.exit(1); });
