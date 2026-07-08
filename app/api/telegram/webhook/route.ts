import { NextResponse } from "next/server";
import { createPendingOperation } from "@/lib/domain/pending";
import { appendTransaction } from "@/lib/storage/excel-store";
import { consumePending, setPending } from "@/lib/storage/pending-store";
import { extractTransactionFromAudio, extractTransactionFromText } from "@/lib/ai/extractor";
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

const confirmationWords = new Set(["si", "sí", "confirmar", "confirmo", "ok", "dale", "guardar"]);
const cancelWords = new Set(["no", "cancelar", "cancela"]);

function normalize(value: string) {
  return value.trim().toLowerCase();
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

      const transaction = await appendTransaction(pending.transaction);
      await sendTelegramMessage(
        chatId,
        `Registrado en Excel: ${transaction.kind} ${transaction.amount} ${transaction.currency} - ${transaction.category}.`,
      );
      return NextResponse.json({ ok: true });
    }

    if (text && cancelWords.has(text)) {
      await consumePending(String(chatId));
      await sendTelegramMessage(chatId, "Movimiento descartado. No se escribio en Excel.");
      return NextResponse.json({ ok: true });
    }

    const fileId = message.voice?.file_id || message.audio?.file_id;
    const extraction = fileId
      ? await extractFromTelegramAudio(fileId, message.voice?.mime_type || message.audio?.mime_type)
      : message.text
        ? await extractTransactionFromText(message.text)
        : null;

    if (!extraction) {
      await sendTelegramMessage(chatId, "Enviame una nota de voz o un texto con el movimiento.");
      return NextResponse.json({ ok: true });
    }

    if (!extraction.clear || !extraction.transaction) {
      await sendTelegramMessage(
        chatId,
        `No fue claro: ${extraction.reason}. Envia algo como "gaste 25000 en almuerzo" o "recibi 100000 de salario".`,
      );
      return NextResponse.json({ ok: true });
    }

    const pending = createPendingOperation(
      String(chatId),
      extraction.transaction,
      extraction.summary,
      message.text || "",
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

async function extractFromTelegramAudio(fileId: string, mimeType?: string) {
  const audio = await downloadTelegramFile(fileId);
  return extractTransactionFromAudio(audio.buffer, mimeType || audio.contentType || "audio/ogg");
}
