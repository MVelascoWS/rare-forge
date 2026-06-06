#!/usr/bin/env node
/**
 * Reset Rare Forge to a clean slate for a fresh demo.
 *
 * Clears the OFF-CHAIN state only:
 *   - Supabase rows: sales, bounties, works (the FK cascade would also handle
 *     this from works, but we delete explicitly).
 *   - ./uploads/* (delivered assets, covers, reference files).
 *
 * Does NOT touch the chain: contracts already deployed on Sepolia persist
 * forever. New works simply deploy fresh contracts; the old ones become orphans
 * with no reference in the app. Table columns / migrations are untouched.
 *
 * Usage:  node scripts/reset-data.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

// Load .env.local (Node doesn't do this automatically).
const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
} catch {
  console.error("Could not read .env.local — run this from the project root.");
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const EPOCH = "1970-01-01"; // matches every row's created_at

for (const table of ["sales", "bounties", "works"]) {
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .gte("created_at", EPOCH);
  if (error) {
    console.error(`✗ ${table}: ${error.message}`);
    process.exit(1);
  }
  console.log(`✓ cleared ${table}: ${count ?? 0} rows`);
}

const uploadsDir = "uploads";
let removed = 0;
if (existsSync(uploadsDir)) {
  for (const f of readdirSync(uploadsDir)) {
    rmSync(path.join(uploadsDir, f), { force: true, recursive: true });
    removed++;
  }
}
console.log(`✓ cleared uploads/: ${removed} files`);

console.log(
  "\nDone. The app is clean. On-chain contracts on Sepolia persist; new works deploy fresh ones."
);
