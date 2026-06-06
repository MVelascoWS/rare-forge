# Rare Forge — Collaborative Creative Pipeline (Rare Protocol x ETHMexico)

A production line for collaborative creative works (games, films, comics) where
**every asset is recorded on-chain with its author**, and when the finished work
sells copies, **royalties split automatically and fairly** among everyone who
built it. Proof-of-work authorship and fair revenue sharing for the
generative-creation era.

> Track: General. Network: **Sepolia (Ethereum)**, chain id `11155111`.

## The honest architecture

The protocol guarantees fair payout for everything sold **on-chain**. An agent
bridges **external** sales — it automates, it does not magically force Steam to
pay. That boundary is drawn on purpose.

| Stage | What happens | Verified rare-cli command |
|---|---|---|
| Create work | Deploy the work's ERC-721 contract | `collection deploy` |
| Open bounty | Requester posts an asset request (off-chain state) | — (Supabase) |
| Creator delivers | Upload asset → IPFS | (handled at mint) |
| Approve → mint | Asset minted to creator, creator set as royalty receiver | `collection mint --royalty-receiver` |
| Seal work | Mint final work referencing child assets (provenance) | `collection mint --attribute component_token=…` |
| Configure store | Direct-sale release with the fair split baked in | `listing release configure --split A=50 --split B=30 …` |
| Sell copy (World A) | Anyone mints a copy → automatic split payout | `listing release mint` |
| External sale (World B) | Simulated event triggers a REAL on-chain split payout | `listing create --split …` |

**World B is a simulated trigger, real transaction.** The "Steam sale" button
fires the same on-chain split listing; only the external event is mocked. This
keeps the demo solid and the pitch honest.

## Business model

Rare Forge charges a **3% fee per copy sale**, taken automatically on-chain as
one more recipient in the same split mechanism that pays creators — no manual
collection, no separate contract, no trust required.

Why 3%: the entire value proposition is *fair to creators*. Steam and the App
Store take 30%. Rare Forge's 3% sits alongside Rare Protocol's own ~3%
marketplace fee, so the total platform take is ~6% — a fraction of the
traditional 30%.

**The creator chooses who absorbs the fee** (set when sealing the work):
- *Absorb*: the fee comes out of the published price; creators net slightly less.
- *Passthrough*: the price is grossed up ~3% so creators keep their full share
  and the buyer covers the fee.

The fee wallet is a single fixed protocol address for the MVP (set via
`RARE_FORGE_FEE_WALLET`). Splits are kept as integers by design (the validated
CLI used integer ratios); rounding remainder goes to the first creator so the
split always sums to exactly 100.

## How the backend talks to Rare Protocol

The Next.js API routes shell out to `rare-cli` with the global `--json` flag
(`src/lib/rare.ts`). This satisfies the bounty requirement to use Rare Protocol
"through RARE CLI" directly, and lets the CLI handle the hard parts (ERC20
approvals, RareMinter calls, the splitter, IPFS pinning, metadata).

The signing wallet's private key lives **only** in backend env. Never in the
client, never in the repo.

## Setup (Sepolia)

```bash
npm install

# 1. Create or import the backend signing wallet
rare wallet generate            # or use an existing key

# 2. Configure the CLI for Sepolia
export RARE_PRIVATE_KEY=0x...           # funded Sepolia wallet (faucet)
export SEPOLIA_RPC_URL=https://...      # your Sepolia RPC endpoint
npm run rare:setup

# 3. Fund the wallet from a Sepolia faucet (gas for mints/splits)

# 4. Supabase
#    Create a project, run supabase/schema.sql, then set:
export NEXT_PUBLIC_SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...

# 5. Run
npm run dev
```

## Screens (separate, as planned)

1. `/work/[id]` — the work + its bounty board (open/claimed/delivered/approved)
2. `/creator` — creator view: claim a bounty, deliver an asset
3. `/seal/[id]` — seal the work: set per-creator split, configure the release
4. `/store/[id]` — copy store (`release mint`) + the "simulate Steam sale" bridge

## Stretch (only if time allows)

`rare mcp serve` exposes the SDK to an agent. The World B bridge can be operated
by an agent over MCP instead of the mock button — same CLI underneath, fully
coherent stack. Left as phase 2 so the core demo never depends on it.

## What's deliberately NOT in the MVP (pitch, not demo)

- Recursive royalty propagation (child-of-child splits)
- A marketplace for reusing isolated assets across works
- Cross-work licensing ("use that game's music in mine")
