import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client. Uses the service key, so this module must only
 * ever be imported from server code (API route handlers, service functions) —
 * never from a client component. The service key bypasses row-level security
 * and must stay in backend env (SUPABASE_SERVICE_KEY).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  // Fail loudly at startup rather than producing confusing runtime errors.
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY not set — " +
      "Supabase calls will fail until these are configured in .env.local"
  );
}

export const supabase = createClient(url ?? "", serviceKey ?? "", {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Shared types — mirror the SQL schema in supabase/schema.sql
// ---------------------------------------------------------------------------

export type WorkStatus = "open" | "sealed";
export type FeeMode = "absorb" | "passthrough";

export type Work = {
  id: string;
  title: string;
  description: string | null;
  requester_addr: string;
  asset_contract: string | null;
  work_contract: string | null;
  status: WorkStatus;
  base_price_eth: number | null;
  fee_mode: FeeMode | null;
  seal_tx_hash: string | null;
  created_at: string;
};

export type BountyStatus =
  | "open"
  | "claimed"
  | "delivered"
  | "approved"
  | "minted";

export type ClaimedByKind = "human" | "agent";

export type Bounty = {
  id: string;
  work_id: string;
  title: string;
  role: string;
  reward_eth: number;
  revenue_percent: number | null;
  status: BountyStatus;
  claimed_by: string | null;
  claimed_by_kind: ClaimedByKind;
  delivery_ipfs: string | null;
  delivery_path: string | null;
  token_id: string | null;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type SaleSource = "onchain_release" | "bridged_external";

export type Sale = {
  id: string;
  work_id: string;
  source: SaleSource;
  quantity: number;
  amount_eth: number;
  tx_hash: string | null;
  created_at: string;
};
