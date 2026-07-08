import { readWorkbook } from "@/lib/storage/excel-store";

export const runtime = "nodejs";

export async function GET() {
  const workbook = await readWorkbook();
  return new Response(new Uint8Array(workbook), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="finanzas.xlsx"',
      "cache-control": "no-store",
    },
  });
}
