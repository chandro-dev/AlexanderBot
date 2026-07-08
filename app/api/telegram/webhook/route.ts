import { NextResponse } from "next/server";
import { createPendingOperation } from "@/lib/domain/pending";
import { summarizeTransactions, type Transaction } from "@/lib/domain/transaction";
import { appendTransactions, readTransactions } from "@/lib/storage/excel-store";
import { consumePending, setPending } from "@/lib/storage/pending-store";
import { understandMessageFromAudio, understandMessageFromText } from "@/lib/ai/extractor";
import { assertTelegramSecret, downloadTelegramFile, sendTelegramMessage } from "@/lib/telegram/client";

export const runtime = "nodejs";

type TelegramUpdate = {
  message?: {
    chat: { id: number };
    text?: string;
    voice?: { file_id: string; mime_type?: string };
    audio?: { file_id: string; mime_type?: string };
  };
};

const confirmationWords = new Set(["si", "confirmar", "confirmo", "ok", "dale", "guardar"]);
const cancelWords = new Set(["no", "cancelar", "cancela"]);

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export async function POST(request: Request) {
  try {
    assertTelegramSecret(request);
    const update = (await request.json()) as TelegramUpdate;
    const message = update.message;
    const chatId = message?.chat.id;

    if (!message || !chatId) return NextResponse.json({ ok: true });

    const text = message.text ? normalize(message.text) : "";

    if (text && confirmationWords.has(text)) {
      const pending = await consumePending(String(chatId));
      if (!pending) {
        await sendTelegramMessage(chatId, "No tengo ningun movimiento pendiente por confirmar.");
        return NextResponse.json({ ok: true });
      }

      const transactions = await appendTransactions(pending.transactions);
      await sendTelegramMessage(
        chatId,
        transactions.length === 1
          ? `Registrado en Excel: ${transactions[0].kind} ${transactions[0].amount} ${transactions[0].currency} - ${transactions[0].category}.`
          : `Registrados ${transactions.length} movimientos en Excel.`,
      );
      return NextResponse.json({ ok: true });
    }

    if (text && cancelWords.has(text)) {
      await consumePending(String(chatId));
      await sendTelegramMessage(chatId, "Movimiento descartado. No se escribio en Excel.");
      return NextResponse.json({ ok: true });
    }

    if (text === "/start" || text === "/help" || text === "ayuda") {
      await sendTelegramMessage(chatId, helpMessage());
      return NextResponse.json({ ok: true });
    }

    const fileId = message.voice?.file_id || message.audio?.file_id;
    const understanding = fileId
      ? await understandTelegramAudio(fileId, message.voice?.mime_type || message.audio?.mime_type)
      : message.text
        ? await understandMessageFromText(message.text)
        : null;

    if (!understanding) {
      await sendTelegramMessage(chatId, "Enviame una nota de voz o un texto. Escribe ayuda para ver ejemplos.");
      return NextResponse.json({ ok: true });
    }

    if (understanding.intent === "greeting") {
      await sendTelegramMessage(chatId, understanding.reply || welcomeMessage());
      return NextResponse.json({ ok: true });
    }

    if (understanding.intent === "help") {
      await sendTelegramMessage(chatId, helpMessage());
      return NextResponse.json({ ok: true });
    }

    if (understanding.intent === "summary") {
      const transactions = await readTransactions();
      await sendTelegramMessage(chatId, formatSummary(transactions));
      return NextResponse.json({ ok: true });
    }

    if (understanding.intent === "recent") {
      const transactions = await readTransactions();
      await sendTelegramMessage(chatId, formatRecent(transactions, understanding.limit));
      return NextResponse.json({ ok: true });
    }

    if (understanding.intent !== "add_transaction") {
      await sendTelegramMessage(chatId, understanding.reply || unclearMessage(understanding.reason));
      return NextResponse.json({ ok: true });
    }

    const transactionsToConfirm = understanding.transactions?.length
      ? understanding.transactions
      : understanding.transaction
        ? [understanding.transaction]
        : [];

    if (!understanding.clear || transactionsToConfirm.length === 0) {
      await sendTelegramMessage(chatId, unclearMessage(understanding.reason));
      return NextResponse.json({ ok: true });
    }

    const pending = createPendingOperation(
      String(chatId),
      transactionsToConfirm,
      formatPendingSummary(understanding.summary, transactionsToConfirm),
      message.text || transactionsToConfirm.map((item) => item.transcript).join(" | "),
    );
    await setPending(pending);

    await sendTelegramMessage(
      chatId,
      `${pending.summary}\n\nResponde "si" para guardar o "no" para cancelar.`,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

async function understandTelegramAudio(fileId: string, mimeType?: string) {
  const audio = await downloadTelegramFile(fileId);
  return understandMessageFromAudio(audio.buffer, mimeType || audio.contentType || "audio/ogg");
}

function welcomeMessage() {
  return [
    "Hola. Puedo registrar gastos e ingresos por texto o audio.",
    "Tambien puedo mostrar resumen y ultimos movimientos.",
    "",
    'Ejemplos: "gaste 25000 en almuerzo", "recibi 100000 de salario", "resumen", "ultimos 5".',
  ].join("\n");
}

function helpMessage() {
  return [
    "Puedes usarme asi:",
    "- Registrar gasto: gaste 25000 en almuerzo",
    "- Registrar ingreso: recibi 100000 de salario",
    "- Ver resumen: resumen o balance",
    "- Ver historial: ultimos 5 movimientos",
    "- Confirmar: si",
    "- Cancelar: no",
    "",
    "Tambien puedes enviarme una nota de voz con esas mismas ideas.",
  ].join("\n");
}

function unclearMessage(reason?: string) {
  const detail = reason ? `: ${reason}` : "";
  return `No fue claro${detail}. Puedes decir "ayuda", "resumen" o algo como "gaste 25000 en almuerzo".`;
}

function formatMoney(amount: number, currency = "COP") {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatSummary(transactions: Transaction[]) {
  if (!transactions.length) {
    return "Aun no hay movimientos registrados.";
  }

  const summary = summarizeTransactions(transactions);
  return [
    "Resumen actual:",
    `Ingresos: ${formatMoney(summary.income)}`,
    `Gastos: ${formatMoney(summary.expenses)}`,
    `Balance: ${formatMoney(summary.balance)}`,
    `Movimientos: ${summary.count}`,
  ].join("\n");
}

function formatRecent(transactions: Transaction[], limit: number) {
  if (!transactions.length) {
    return "Aun no hay movimientos registrados.";
  }

  const rows = transactions.slice(0, limit).map((item) => {
    const sign = item.kind === "expense" ? "-" : item.kind === "income" ? "+" : "";
    return `${item.date} ${sign}${formatMoney(item.amount, item.currency)} ${item.category} - ${item.description}`;
  });

  return [`Ultimos ${rows.length} movimientos:`, ...rows].join("\n");
}

function formatPendingSummary(summary: string, transactions: Array<{
  kind: Transaction["kind"];
  amount: number;
  currency: string;
  category: string;
  description: string;
}>) {
  if (transactions.length === 1) return summary;

  const rows = transactions.slice(0, 10).map((item, index) => {
    const label = item.kind === "expense" ? "Gasto" : item.kind === "income" ? "Ingreso" : item.kind;
    return `${index + 1}. ${label} ${formatMoney(item.amount, item.currency)} ${item.category} - ${item.description}`;
  });

  return [summary || `Encontre ${transactions.length} movimientos para confirmar:`, ...rows].join("\n");
}
