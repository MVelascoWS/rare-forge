import { NextRequest, NextResponse } from "next/server";
import { sealWork } from "@/lib/services/works";

// POST /api/works/:id/seal — deploy lazy collection, prepare, configure release
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { basePriceEth, feeMode, imagePath } = body ?? {};
  if (basePriceEth == null || !feeMode || !imagePath) {
    return NextResponse.json(
      { error: "basePriceEth, feeMode, imagePath are required" },
      { status: 400 }
    );
  }
  const result = await sealWork({
    workId: params.id,
    basePriceEth: Number(basePriceEth),
    feeMode,
    imagePath,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.data);
}
