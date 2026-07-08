import { z } from "zod";
import { transactionInputSchema } from "./transaction";

export const pendingOperationSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().min(1),
  transaction: transactionInputSchema.optional(),
  transactions: z.array(transactionInputSchema).min(1).optional(),
  summary: z.string().min(1),
  rawMessage: z.string().default(""),
  createdAt: z.string().datetime(),
}).transform((operation) => ({
  ...operation,
  transactions: operation.transactions ?? (operation.transaction ? [operation.transaction] : []),
}));

export const pendingStoreSchema = z.record(z.string(), pendingOperationSchema);

export type PendingOperation = z.infer<typeof pendingOperationSchema>;
export type PendingStore = z.infer<typeof pendingStoreSchema>;

export function createPendingOperation(
  chatId: string,
  transactions: z.infer<typeof transactionInputSchema> | Array<z.infer<typeof transactionInputSchema>>,
  summary: string,
  rawMessage: string,
): PendingOperation {
  const normalizedTransactions = Array.isArray(transactions) ? transactions : [transactions];

  return pendingOperationSchema.parse({
    id: crypto.randomUUID().slice(0, 8),
    chatId,
    transaction: normalizedTransactions[0],
    transactions: normalizedTransactions,
    summary,
    rawMessage,
    createdAt: new Date().toISOString(),
  });
}
