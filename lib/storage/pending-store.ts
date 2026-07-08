import { pendingStoreSchema, type PendingOperation } from "@/lib/domain/pending";
import { readObject, writeObject } from "./object-store";

const pendingPath = "pending-operations.json";

export async function readPendingStore() {
  const file = await readObject(pendingPath);
  if (!file) return {};
  return pendingStoreSchema.parse(JSON.parse(file.toString("utf8")));
}

export async function setPending(operation: PendingOperation) {
  const store = await readPendingStore();
  store[operation.chatId] = operation;
  await writeObject(pendingPath, JSON.stringify(store, null, 2), "application/json");
}

export async function consumePending(chatId: string) {
  const store = await readPendingStore();
  const operation = store[chatId];
  if (!operation) return null;

  delete store[chatId];
  await writeObject(pendingPath, JSON.stringify(store, null, 2), "application/json");
  return operation;
}
