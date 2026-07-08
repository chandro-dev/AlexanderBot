import ExcelJS from "exceljs";
import {
  createTransaction,
  transactionSchema,
  transactionsPayloadSchema,
  updateTransaction,
  type Transaction,
  type TransactionInput,
} from "@/lib/domain/transaction";
import { readObject, writeObject } from "./object-store";

const workbookPath = "finanzas.xlsx";
const sheetName = "Movimientos";

const headers = [
  "id",
  "date",
  "kind",
  "amount",
  "currency",
  "category",
  "description",
  "source",
  "transcript",
  "confidence",
  "createdAt",
  "updatedAt",
];

export async function readTransactions(): Promise<Transaction[]> {
  const file = await readObject(workbookPath);
  if (!file) return [];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as any);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const item: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const value = row.getCell(index + 1).value;
      item[header] = typeof value === "object" && value && "text" in value ? value.text : value;
    });
    rows.push(item);
  });

  return transactionsPayloadSchema
    .parse({ transactions: rows.map((row) => transactionSchema.parse(row)) })
    .transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function replaceTransactions(transactions: Transaction[]) {
  const sorted = transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "appfinanzas";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: header === "description" || header === "transcript" ? 36 : 18,
  }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  sorted.forEach((transaction) => worksheet.addRow(transaction));

  const output = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(output);
  await writeObject(workbookPath, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export async function appendTransaction(input: TransactionInput) {
  const transactions = await readTransactions();
  const transaction = createTransaction(input);
  await replaceTransactions([transaction, ...transactions]);
  return transaction;
}

export async function upsertTransactions(inputs: Transaction[]) {
  const normalized = inputs.map((input) => {
    const existing = input.id ? input : createTransaction(input);
    return updateTransaction(existing, input);
  });
  await replaceTransactions(normalized);
  return normalized;
}

export async function readWorkbook() {
  const file = await readObject(workbookPath);
  if (file) return file;
  await replaceTransactions([]);
  return (await readObject(workbookPath)) ?? Buffer.from("");
}
