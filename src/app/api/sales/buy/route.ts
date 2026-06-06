import { NextRequest, NextResponse } from "next/server";
import { buyCopy } from "@/lib/services/sales";

// POST /api/sales/buy  { workId, quantity?, recipient? }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { workId, quantity, recipient } = body ?? {};
  if (!workId) return NextResponse.json({ error: "workId is required" }, { status: 400 });
  const result = await buyCopy({ workId, quantity, recipient });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.data);
}
