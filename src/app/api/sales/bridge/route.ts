import { NextRequest, NextResponse } from "next/server";
import { bridgeExternalSale } from "@/lib/services/sales";

// POST /api/sales/bridge
//   { workId, receiptContract, receiptTokenId, priceEth, principalAddress, participants }
//
// The external event (Steam sale) is simulated by the caller; the on-chain
// split payout is real. This is the same function the MCP agent will call.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    workId,
    receiptContract,
    receiptTokenId,
    priceEth,
    principalAddress,
    participants,
  } = body ?? {};

  if (!workId || !receiptContract || !receiptTokenId || !priceEth || !principalAddress) {
    return NextResponse.json(
      { error: "workId, receiptContract, receiptTokenId, priceEth, principalAddress are required" },
      { status: 400 }
    );
  }

  const result = await bridgeExternalSale({
    workId,
    receiptContract,
    receiptTokenId,
    priceEth: String(priceEth),
    principalAddress,
    participants: participants ?? [],
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.data);
}
