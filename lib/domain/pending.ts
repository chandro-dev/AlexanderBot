import { z } from "zod";
import { transactionInputSchema } from "./transaction";

export const pendingOperationSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().min(1),
  transaction: transactionInputSchema,
  summary: z.string().min(1),
  rawMessage: z.string().default(""),
  createdAt: z.string().datetime(),
});

export const pendingStoreSchema = z.record(z.string(), pendingOperationSchema);

export type PendingOperation = z.infer<typeof pendingOperationSchema>;
export type PendingStore = z.infer<typeof pendingStoreSchema>;

export function createPendingOperation(
  chatId: string,
  transaction: z.infer<typeof transactionInputSchema>,
  summary: string,
  rawMessage: string,
): PendingOperation {
  return pendingOperationSchema.parse({
    id: crypto.randomUUID().slice(0, 8),
    chatId,
    transaction,
    summary,
    rawMessage,
    createdAt: new Date().toISOString(),
  });
}
