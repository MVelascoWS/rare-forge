import { NextRequest, NextResponse } from "next/server";
import { approveAndMint, requestChanges } from "@/lib/services/bounties";

// POST /api/bounties/:id/approve
//   { assetContract }            -> approve + mint on-chain
//   { action: "request_changes" } -> bounce back to claimed
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();

  if (body?.action === "request_changes") {
    const result = await requestChanges(params.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ bounty: result.data });
  }

  const { assetContract } = body ?? {};
  if (!assetContract) {
    return NextResponse.json({ error: "assetContract is required" }, { status: 400 });
  }
  const result = await approveAndMint({ bountyId: params.id, assetContract });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ bounty: result.data });
}
