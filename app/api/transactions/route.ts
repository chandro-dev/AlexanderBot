import { NextResponse } from "next/server";
import { transactionSchema, transactionsPayloadSchema } from "@/lib/domain/transaction";
import { readTransactions, upsertTransactions } from "@/lib/storage/excel-store";

export const runtime = "nodejs";

export async function GET() {
  const transactions = await readTransactions();
  return NextResponse.json({ transactions });
}

export async function PUT(request: Request) {
  const payload = transactionsPayloadSchema.parse(await request.json());
  const transactions = await upsertTransactions(payload.transactions.map((item) => transactionSchema.parse(item)));
  return NextResponse.json({ transactions });
}
