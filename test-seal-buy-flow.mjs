#!/usr/bin/env node
/**
 * Rare Forge — seal + buy flow test (via HTTP API)
 * -------------------------------------------------
 * Completes backend validation: takes a work with a minted bounty, seals it
 * (deploy lazy + prepare lazy mint + configure release with the fair split),
 * then buys a copy (which triggers the on-chain split payout). Stops at the
 * first failure.
 *
 * Flow:
 *   1. POST /api/works                     create work (asset contract)
 *   2. POST /api/works/:id                 open a bounty (with revenuePercent)
 *   3. POST /api/bounties/:id/claim        artist claims
 *   4. POST /api/bounties/:id/deliver      artist delivers
 *   5. POST /api/bounties/:id/approve      approve + mint asset on-chain
 *   --- now the work has a minted participant; seal + sell ---
 *   6. POST /api/works/:id/seal            seal: deploy lazy + prepare + release
 *   7. POST /api/sales/buy                 buy a copy (triggers split payout)
 *   8. GET  /api/works/:id                 verify sealed + work_contract set
 *
 * PREREQUISITES: app running, .env.local set, test-assets images reachable by
 * the backend. The buy step spends real Sepolia ETH (the copy price below).
 *
 * RUN (app running in another terminal):
 *   node test-seal-buy-flow.mjs
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ARTIST_WALLET = process.env.ARTIST_WALLET ?? "0xbA17093837730b791Ff8FeDCDdb49763f9dCE3a9";
const REQUESTER_WALLET = process.env.REQUESTER_WALLET ?? "0x917EA4491C10d9d55398aBFc93B89d171C95f253";
const DELIVERY_PATH = process.env.DELIVERY_PATH ?? "test-assets/asset1.png";
const WORK_IMAGE = process.env.WORK_IMAGE ?? "test-assets/final.png";
const COPY_PRICE_ETH = process.env.COPY_PRICE_ETH ?? "0.0001";

let stepNum = 0;
function hr() { console.log("\n" + "=".repeat(72)); }

async function call(label, method, path, body) {
  hr();
  stepNum++;
  console.log(`STEP ${stepNum}: ${label}`);
  console.log(`  ${method} ${path}`);
  if (body) console.log(`  body: ${JSON.stringify(body)}`);

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.log("  ✗ NETWORK ERROR — is the app running?");
    console.log("  ", err.message);
    process.exit(1);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }

  if (!res.ok) {
    console.log(`  ✗ FAILED (HTTP ${res.status})`);
    console.log("  response:", JSON.stringify(json, null, 2).slice(0, 1500));
    console.log("\nStopping here. Inspect the error above.");
    process.exit(1);
  }
  console.log(`  ✓ ok (HTTP ${res.status})`);
  console.log("  response:", JSON.stringify(json, null, 2).slice(0, 1100));
  return json;
}

async function main() {
  hr();
  console.log("Rare Forge — seal + buy flow test");
  console.log(`Base URL: ${BASE_URL}`);
  console.log("This triggers REAL Sepolia transactions (deploys, mint, release, copy sale).");

  // 1-5: build a work with a minted participant (reusing the proven flow).
  const work = (await call("Create work", "POST", "/api/works", {
    title: "Seal Test Work",
    description: "Seal + buy validation",
    requesterAddr: REQUESTER_WALLET,
  })).work;
  if (!work?.id || !work?.asset_contract) { console.log("\n! Work missing fields."); process.exit(1); }
  console.log(`  >> work id: ${work.id}`);

  const bounty = (await call("Open bounty", "POST", `/api/works/${work.id}`, {
    title: "Concept art - protagonist",
    role: "concept_artist",
    rewardEth: 0.01,
    revenuePercent: 10,
  })).bounty;

  await call("Claim bounty", "POST", `/api/bounties/${bounty.id}/claim`, {
    wallet: ARTIST_WALLET, kind: "human",
  });

  await call("Deliver asset", "POST", `/api/bounties/${bounty.id}/deliver`, {
    wallet: ARTIST_WALLET, deliveryPath: DELIVERY_PATH,
  });

  await call("Approve + mint", "POST", `/api/bounties/${bounty.id}/approve`, {
    assetContract: work.asset_contract,
  });

  // 6: SEAL — the riskiest step (3 chained on-chain txs).
  const sealed = await call("Seal work", "POST", `/api/works/${work.id}/seal`, {
    basePriceEth: COPY_PRICE_ETH,
    feeMode: "absorb",
    imagePath: WORK_IMAGE,
  });
  console.log("  >> breakdown:", JSON.stringify(sealed?.breakdown ?? null));

  // 7: BUY a copy — triggers the on-chain split payout.
  const sale = await call("Buy a copy", "POST", "/api/sales/buy", {
    workId: work.id,
    quantity: 1,
  });
  console.log(`  >> sale tx: ${sale?.txHash}  |  tokenIds: ${JSON.stringify(sale?.tokenIds)}`);

  // 8: verify final state.
  const final = await call("Verify final state", "GET", `/api/works/${work.id}`);
  hr();
  const w = final.work;
  if (w?.status === "sealed" && w?.work_contract && w?.seal_tx_hash) {
    console.log("SEAL + BUY FLOW PASSED ✓");
    console.log("Backend fully validated: work sealed, release live, copy sold with split.");
    console.log(`\nWork contract (lazy): ${w.work_contract}`);
    console.log(`Seal tx: ${w.seal_tx_hash}`);
    console.log(`Copy sale tx: ${sale?.txHash}`);
    console.log("\nVerify on Sepolia Etherscan: the copy-sale tx's INTERNAL transactions");
    console.log("show payouts to the principal, the participant, and the 3% fee wallet.");
  } else {
    console.log("Flow completed but final state is unexpected — inspect above.");
    console.log("work status:", w?.status, "| work_contract:", w?.work_contract);
  }
}

main().catch((e) => { console.error("Unexpected error:", e); process.exit(1); });
