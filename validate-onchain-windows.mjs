#!/usr/bin/env node
/**
 * Forge — onchain flow validation (Sepolia)
 * ------------------------------------------
 * Runs the full pipeline against real Sepolia transactions and prints a
 * checkpoint after each step. STOPS at the first failure so you can inspect
 * exactly where the flow breaks and what the real JSON shape looks like.
 *
 * This is a VALIDATION script — run it manually before building UI. It is NOT
 * part of the app. Every command here uses flags verified against rare-cli
 * v1.2.2 `--help`.
 *
 * PREREQUISITES (you must do these — they cannot run in a sandbox):
 *   1. A Sepolia wallet funded with faucet ETH (gas + the tiny --price below).
 *   2. rare-cli configured for Sepolia:
 *        export RARE_PRIVATE_KEY=0x...
 *        export SEPOLIA_RPC_URL=https://...
 *        rare configure --chain sepolia --chain-id 11155111 \
 *          --private-key $RARE_PRIVATE_KEY --rpc-url $SEPOLIA_RPC_URL
 *   3. Two extra addresses to act as collaborators for the split test
 *      (set CREATOR_A and CREATOR_B below, or they default to the signer).
 *
 * RUN:
 *   node validate-onchain.mjs
 *
 * Each step prints: the exact command, ok/fail, and the parsed result.
 * Artifacts (contract address, token ids) are captured and reused downstream.
 */

import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Windows: rare is installed as rare.cmd. Using shell:true lets the OS resolve
// the .cmd extension automatically (avoids "spawn rare ENOENT"). The trade-off
// is that arguments now pass through the shell, so any value containing spaces
// or special characters MUST be quoted. quoteArg() below handles that.
const USE_SHELL = process.platform === "win32";

function quoteArg(arg) {
  const s = String(arg);
  // On Windows cmd, wrap anything with spaces or special chars in double quotes
  // and escape embedded double quotes.
  if (/[\s"&|<>^()]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CHAIN = "sepolia";
const CHAIN_ID = "11155111";
const RARE_BIN = process.env.RARE_BIN ?? "rare";

// Collaborators for the split test. Default to the signer's own address so the
// script still runs with a single wallet; set these to see a real multi-payout.
const SIGNER = process.env.SIGNER_ADDRESS ?? null; // filled in from wallet address
let CREATOR_A = process.env.CREATOR_A ?? null;
let CREATOR_B = process.env.CREATOR_B ?? null;

// Tiny price so the copy-sale test costs almost nothing on Sepolia.
const COPY_PRICE_ETH = process.env.COPY_PRICE_ETH ?? "0.0001";

// Folder containing test images (asset1.png, asset2.png, final.png).
// Defaults to ./test-assets relative to where you run the script.
const ASSETS_DIR = process.env.ASSETS_DIR ?? "test-assets";
const path = await import("node:path");
const img = (name) => path.join(ASSETS_DIR, name);

const artifacts = {};

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
      // Build a single quoted command line and run it through the shell so
      // Windows resolves rare.cmd and spaces in args survive.
      const cmdLine = [RARE_BIN, ...fullArgs].map(quoteArg).join(" ");
      console.log(`  $ ${cmdLine}`);
      ({ stdout, stderr } = await execAsync(cmdLine, {
        maxBuffer: 1024 * 1024 * 8,
        timeout: 180_000,
        windowsHide: true,
      }));
    } else {
      console.log(`  $ ${RARE_BIN} ${fullArgs.join(" ")}`);
      ({ stdout, stderr } = await execFileAsync(RARE_BIN, fullArgs, {
        maxBuffer: 1024 * 1024 * 8,
        timeout: 180_000,
      }));
    }
    const raw = stdout.trim();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = extractLastJson(raw);
    }
    console.log("  ✓ ok");
    console.log("  result:", JSON.stringify(data ?? raw, null, 2).slice(0, 1200));
    if (stderr?.trim()) console.log("  stderr:", stderr.trim().slice(0, 400));
    return { ok: true, data, raw };
  } catch (err) {
    console.log("  ✗ FAILED");
    console.log("  error:", (err.stderr || err.message || "").trim().slice(0, 1500));
    console.log("\nStopping here. Inspect the error above before continuing.");
    writeFileSync("validate-artifacts.json", JSON.stringify(artifacts, null, 2));
    process.exit(1);
  }
}

function extractLastJson(text) {
  const last = Math.max(text.lastIndexOf("{"), text.lastIndexOf("["));
  for (let s = last; s >= 0; s--) {
    if (text[s] !== "{" && text[s] !== "[") continue;
    try {
      return JSON.parse(text.slice(s));
    } catch {}
  }
  return null;
}

// Best-effort field extraction — the real JSON shape is what we're validating,
// so we probe a few likely key names and log what we find.
function pick(data, keys) {
  if (!data || typeof data !== "object") return undefined;
  for (const k of keys) {
    if (data[k] != null) return data[k];
    // one level down
    for (const v of Object.values(data)) {
      if (v && typeof v === "object" && v[k] != null) return v[k];
    }
  }
  return undefined;
}

async function main() {
  hr();
  console.log("Forge onchain validation — Sepolia");
  console.log("This runs REAL transactions. Make sure your wallet is funded.");

  // 0. Confirm wallet + capture signer address
  const w = await step("Read configured wallet address", ["wallet", "address"]);
  const signer = pick(w.data, ["address", "wallet", "account"]) ?? SIGNER;
  console.log("  signer:", signer);
  CREATOR_A = CREATOR_A ?? signer;
  CREATOR_B = CREATOR_B ?? signer;
  artifacts.signer = signer;

  // 1. Deploy the ASSET collection (normal erc721). Individual creator assets
  //    are minted directly here — each is a unique, attributed piece.
  const depAssets = await step("Deploy erc721 collection (for creator assets)", [
    "collection", "deploy", "erc721",
    "Forge Assets", "FRGA",
    "--max-tokens", "1000",
  ]);
  const assetContract = pick(depAssets.data, ["contract", "contractAddress", "address", "collection"]);
  console.log("  >> asset contract:", assetContract);
  if (!assetContract) {
    console.log("  ! Could not auto-extract contract address. Inspect JSON above.");
    writeFileSync("validate-artifacts.json", JSON.stringify(artifacts, null, 2));
    process.exit(1);
  }
  artifacts.assetContract = assetContract;

  // 2. Mint asset #1 to creator A (creator = royalty receiver) on the normal contract
  const m1 = await step("Mint asset #1 (concept art) to creator A", [
    "collection", "mint",
    "--contract", assetContract,
    "--name", "Concept art - protagonist",
    "--description", "Forge validation asset 1",
    "--image", img("asset1.png"),
    "--royalty-receiver", CREATOR_A,
    "--to", CREATOR_A,
    "--attribute", "asset_type=concept_art",
  ]);
  artifacts.asset1 = { tokenId: pick(m1.data, ["tokenId", "token_id", "id"]), tx: pick(m1.data, ["txHash", "transactionHash", "tx", "hash"]) };
  console.log("  >> asset1:", artifacts.asset1);

  // 3. Mint asset #2 to creator B on the normal contract
  const m2 = await step("Mint asset #2 (music) to creator B", [
    "collection", "mint",
    "--contract", assetContract,
    "--name", "Soundtrack - main theme",
    "--description", "Forge validation asset 2",
    "--image", img("asset2.png"),
    "--royalty-receiver", CREATOR_B,
    "--to", CREATOR_B,
    "--attribute", "asset_type=music",
  ]);
  artifacts.asset2 = { tokenId: pick(m2.data, ["tokenId", "token_id", "id"]), tx: pick(m2.data, ["txHash", "transactionHash", "tx", "hash"]) };
  console.log("  >> asset2:", artifacts.asset2);

  // 4. Verify on-chain royalty receiver for asset #1 (proof-of-authorship)
  if (artifacts.asset1.tokenId != null) {
    await step("Read royalty receiver for asset #1 (ERC-2981)", [
      "collection", "royalty", "status",
      "--contract", assetContract,
      "--token-id", String(artifacts.asset1.tokenId),
    ]);
  }

  // 5. Deploy the WORK collection (lazy-erc721) — required for the copy-sale release.
  const depWork = await step("Deploy lazy-erc721 collection (for the work's copy release)", [
    "collection", "deploy", "lazy-erc721",
    "Forge Work", "FRGW",
    "--max-tokens", "1000",
    "--contract-type", "lazy",
  ]);
  const workContract = pick(depWork.data, ["contract", "contractAddress", "address", "collection"]);
  console.log("  >> work contract:", workContract);
  if (!workContract) {
    console.log("  ! Could not auto-extract work contract address. Inspect JSON above.");
    writeFileSync("validate-artifacts.json", JSON.stringify(artifacts, null, 2));
    process.exit(1);
  }
  artifacts.workContract = workContract;

  // 6. Prepare the lazy mint batch and approve RareMinter as the minter.
  //    This is the "Prepare lazy mint metadata, approve RareMinter" step the
  //    deploy nextStep told us about. --minter rare-minter approves RareMinter.
  await step("Prepare lazy mint batch + approve RareMinter", [
    "collection", "prepare-lazy-mint",
    "--contract", workContract,
    "--base-uri", "ipfs://forge-validation-placeholder/",
    "--amount", "100",
    "--minter", "rare-minter",
  ]);

  // 7. Seal the work: configure a RareMinter release with the fair split.
  //    This split applies to EVERY copy minted — the recurring-royalty core.
  await step("Configure release with fair split (50/50)", [
    "listing", "release", "configure",
    "--contract", workContract,
    "--price", COPY_PRICE_ETH,
    "--currency", "eth",
    "--max-mints", "0",
    "--split", `${CREATOR_A}=50`,
    "--split", `${CREATOR_B}=50`,
    "--yes",
  ]);

  // 8. Read release status to confirm it's live
  await step("Read release status", [
    "listing", "release", "status",
    "--contract", workContract,
  ]);

  // 9. Sell a copy (Mundo A): mint from the release. This triggers the split.
  const buy = await step("Mint a copy from the release (triggers split payout)", [
    "listing", "release", "mint",
    "--contract", workContract,
    "--quantity", "1",
    "--yes",
  ]);
  artifacts.copySale = { tx: pick(buy.data, ["txHash", "transactionHash", "tx", "hash"]) };
  console.log("  >> copy sale:", artifacts.copySale);

  hr();
  console.log("ALL STEPS PASSED ✓");
  console.log("The full onchain flow works: deploy → mint assets → seal → sell copy with split.");
  console.log("\nArtifacts:");
  console.log(JSON.stringify(artifacts, null, 2));
  writeFileSync("validate-artifacts.json", JSON.stringify(artifacts, null, 2));
  console.log("\nSaved to validate-artifacts.json");
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
