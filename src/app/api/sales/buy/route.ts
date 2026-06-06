import { NextRequest, NextResponse } from "next/server";
import { buyCopy } from "@/lib/services/sales";

// POST /api/sales/buy  { workId, quantity? }
// Note: no recipient — RareMinter's direct-sale mint always mints to the signer
// (the backend wallet). The on-chain split payout is the point and fires anyway.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { workId, quantity } = body ?? {};
  if (!workId) return NextResponse.json({ error: "workId is required" }, { status: 400 });
  const result = await buyCopy({ workId, quantity });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.data);
}
