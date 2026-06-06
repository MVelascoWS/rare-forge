-- Rare Forge — Supabase schema
-- Off-chain state that orchestrates the collaborative pipeline.
-- On-chain truth (mints, splits, releases) lives on Sepolia via rare-cli;
-- this schema tracks workflow state and links to on-chain artifacts.

-- A creative work (e.g. a game) that multiple creators build together.
create table works (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  requester_addr  text not null,                 -- principal creator's wallet
  asset_contract  text,                          -- erc721 for individual assets
  work_contract   text,                          -- lazy-erc721 for the copy release
  status          text not null default 'open'   -- open | sealed
                  check (status in ('open', 'sealed')),
  base_price_eth  numeric,                        -- copy price set at seal time
  fee_mode        text check (fee_mode in ('absorb','passthrough')),
  seal_tx_hash    text,                           -- release configure tx
  created_at      timestamptz not null default now()
);

-- A bounty: an open request for one asset within a work.
-- This is the core state machine the flow diagrams showed.
create table bounties (
  id              uuid primary key default gen_random_uuid(),
  work_id         uuid not null references works(id) on delete cascade,
  title           text not null,                 -- "Concept art protagonista"
  role            text not null,                 -- concept_artist | modeler | animator | musician ...
  reward_eth      numeric not null,
  revenue_percent int,                            -- % of the work granted to this participant
  status          text not null default 'open'
                  check (status in ('open','claimed','delivered','approved','minted')),
  claimed_by      text,                           -- creator wallet (human or agent)
  claimed_by_kind text default 'human'            -- human | agent
                  check (claimed_by_kind in ('human','agent')),
  delivery_ipfs   text,                           -- creator's uploaded asset (IPFS)
  delivery_path   text,                           -- local path for rare mint --image
  token_id        text,                           -- set after mintAsset succeeds
  tx_hash         text,                           -- on-chain proof of the mint
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Recorded copy sales (Mundo A: on-chain release mints, and Mundo B: bridged
-- external sales). Both result in a real on-chain split payout.
create table sales (
  id              uuid primary key default gen_random_uuid(),
  work_id         uuid not null references works(id) on delete cascade,
  source          text not null                  -- onchain_release | bridged_external
                  check (source in ('onchain_release','bridged_external')),
  quantity        int not null default 1,
  amount_eth      numeric not null,
  tx_hash         text,
  created_at      timestamptz not null default now()
);

create index idx_bounties_work on bounties(work_id);
create index idx_bounties_status on bounties(status);
create index idx_sales_work on sales(work_id);
