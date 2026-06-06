#!/usr/bin/env node
/**
 * Rare Forge — full bounty flow test (via HTTP API)
 * --------------------------------------------------
 * Exercises the whole requester+artist bounty cycle through the running app's
 * API, stopping at the first failure so you can see exactly where it breaks.
 *
 * Flow:
 *   1. POST /api/works                 create work (deploys asset contract)
 *   2. POST /api/works/:id             open a bounty
 *   3. POST /api/bounties/:id/claim    artist claims it
 *   4. POST /api/bounties/:id/deliver  artist delivers (local image path)
 *   5. POST /api/bounties/:id/approve  requester approves -> mints on-chain
 *   6. GET  /api/works/:id             verify final state
 *
 * PREREQUISITES:
 *   - The app is running (npm run dev) on BASE_URL below.
 *   - .env.local configured (Supabase + rare-cli + Sepolia).
 *   - test-assets/asset1.png exists relative to the project root (the backend
 *     passes this path to `rare mint --image`, so it must be reachable BY THE
 *     BACKEND process, i.e. an absolute path or one relative to where the app runs).
 *
 * RUN (with the app running in another terminal):
 *   node test-bounty-flow.mjs
 *
 * Override the image path if needed:
 *   DELIVERY_PATH="C:\\full\\path\\to\\asset1.png" node test-bounty-flow.mjs
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

// The artist's wallet (any address; it becomes the asset's royalty receiver).
const ARTIST_WALLET = process.env.ARTIST_WALLET ?? "0xbA17093837730b791Ff8FeDCDdb49763f9dCE3a9";
// The requester/principal wallet (owns the work).
const REQUESTER_WALLET = process.env.REQUESTER_WALLET ?? "0x917EA4491C10d9d55398aBFc93B89d171C95f253";
// Local image the backend will mint. Must be reachable by the backend process.
const DELIVERY_PATH = process.env.DELIVERY_PATH ?? "test-assets/asset1.png";

let stepNum = 0;

function hr() {
  console.log("\n" + "=".repeat(72));
}

async function call(label, method, path, body) {
  hr();
  stepNum++;
  console.log(`STEP ${stepNum}: ${label}`);
  console.log(`  ${method} ${path}`);
  if (body) console.log(`  body: ${JSON.stringify(body)}`);

  let res, json;
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
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!res.ok) {
    console.log(`  ✗ FAILED (HTTP ${res.status})`);
    console.log("  response:", JSON.stringify(json, null, 2).slice(0, 1200));
    console.log("\nStopping here. Inspect the error above.");
    process.exit(1);
  }

  console.log(`  ✓ ok (HTTP ${res.status})`);
  console.log("  response:", JSON.stringify(json, null, 2).slice(0, 1000));
  return json;
}

async function main() {
  hr();
  console.log("Rare Forge — full bounty flow test");
  console.log(`Base URL: ${BASE_URL}`);
  console.log("This triggers REAL Sepolia transactions (work deploy + asset mint).");

  // 1. Create the work (deploys the asset collection on-chain).
  const work = (await call("Create work", "POST", "/api/works", {
    title: "Flow Test Work",
    description: "End-to-end bounty flow validation",
    requesterAddr: REQUESTER_WALLET,
  })).work;
  if (!work?.id || !work?.asset_contract) {
    console.log("\n! Work missing id or asset_contract — cannot continue.");
    process.exit(1);
  }
  console.log(`  >> work id: ${work.id}`);
  console.log(`  >> asset contract: ${work.asset_contract}`);

  // 2. Open a bounty in the work.
  const bounty = (await call("Open bounty", "POST", `/api/works/${work.id}`, {
    title: "Concept art - protagonist",
    role: "concept_artist",
    rewardEth: 0.01,
    revenuePercent: 10,
  })).bounty;
  if (!bounty?.id) {
    console.log("\n! Bounty missing id — cannot continue.");
    process.exit(1);
  }
  console.log(`  >> bounty id: ${bounty.id}`);

  // 3. Artist claims the bounty.
  await call("Claim bounty (artist)", "POST", `/api/bounties/${bounty.id}/claim`, {
    wallet: ARTIST_WALLET,
    kind: "human",
  });

  // 4. Artist delivers the asset (local image path the backend will mint).
  await call("Deliver asset", "POST", `/api/bounties/${bounty.id}/deliver`, {
    wallet: ARTIST_WALLET,
    deliveryPath: DELIVERY_PATH,
  });

  // 5. Requester approves -> mints the asset on-chain to the artist.
  const approved = (await call("Approve + mint", "POST", `/api/bounties/${bounty.id}/approve`, {
    assetContract: work.asset_contract,
  })).bounty;
  console.log(`  >> minted token id: ${approved?.token_id}`);
  console.log(`  >> mint tx: ${approved?.tx_hash}`);

  // 6. Verify the final state of the work + bounties.
  const final = await call("Verify final state", "GET", `/api/works/${work.id}`);
  const b = final.bounties?.[0];
  hr();
  if (b?.status === "minted" && b?.token_id && b?.tx_hash) {
    console.log("FULL BOUNTY FLOW PASSED ✓");
    console.log("open -> claimed -> delivered -> approved -> minted, asset on-chain.");
    console.log(`\nAsset contract: ${work.asset_contract}`);
    console.log(`Token id: ${b.token_id}  |  tx: ${b.tx_hash}`);
    console.log("Verify on Sepolia Etherscan that the token's royalty receiver is the artist.");
  } else {
    console.log("Flow completed but final state is unexpected — inspect above.");
    console.log("bounty status:", b?.status, "| token:", b?.token_id);
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
