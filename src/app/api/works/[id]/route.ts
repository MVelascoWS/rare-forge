import { NextRequest, NextResponse } from "next/server";
import { getWorkWithBounties, openBounty } from "@/lib/services/works";

// GET /api/works/:id — work + its bounties (bounty board)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const result = await getWorkWithBounties(params.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result.data);
}

// POST /api/works/:id — open a bounty within this work
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { title, role, rewardEth, revenuePercent } = body ?? {};
  if (!title || !role || rewardEth == null) {
    return NextResponse.json({ error: "title, role, rewardEth are required" }, { status: 400 });
  }
  const result = await openBounty({
    workId: params.id,
    title,
    role,
    rewardEth: Number(rewardEth),
    revenuePercent: revenuePercent != null ? Number(revenuePercent) : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ bounty: result.data });
}
