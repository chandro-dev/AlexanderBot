import { z } from "zod";

export const transactionKinds = ["expense", "income", "transfer", "adjustment"] as const;

export const transactionSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(transactionKinds),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(2).max(8).default("COP"),
  category: z.string().trim().min(1),
  description: z.string().trim().min(1),
  source: z.enum(["telegram", "manual"]).default("manual"),
  transcript: z.string().trim().optional().default(""),
  confidence: z.coerce.number().min(0).max(1).default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const transactionInputSchema = transactionSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial({ source: true, transcript: true, confidence: true });

export const transactionsPayloadSchema = z.object({
  transactions: z.array(transactionSchema),
});

export type Transaction = z.infer<typeof transactionSchema>;
export type TransactionInput = z.infer<typeof transactionInputSchema>;

export function createTransaction(input: TransactionInput): Transaction {
  const now = new Date().toISOString();
  const merged = {
    ...input,
    currency: input.currency || "COP",
    source: input.source || "manual",
    transcript: input.transcript || "",
    confidence: input.confidence ?? 0,
  };

  return transactionSchema.parse({
    id: crypto.randomUUID(),
    ...merged,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateTransaction(existing: Transaction, input: Partial<Transaction>): Transaction {
  return transactionSchema.parse({
    ...existing,
    ...input,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
}

export function summarizeTransactions(transactions: Transaction[]) {
  return transactions.reduce(
    (summary, item) => {
      if (item.kind === "expense") summary.expenses += item.amount;
      if (item.kind === "income") summary.income += item.amount;
      summary.balance = summary.income - summary.expenses;
      return summary;
    },
    { income: 0, expenses: 0, balance: 0, count: transactions.length },
  );
}
