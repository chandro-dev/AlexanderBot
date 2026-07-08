import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { transactionInputSchema, type TransactionInput } from "@/lib/domain/transaction";

const botUnderstandingSchema = z.object({
  intent: z.enum(["greeting", "help", "add_transaction", "summary", "recent", "unknown"]),
  clear: z.boolean(),
  reason: z.string().default(""),
  reply: z.string().default(""),
  summary: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  transaction: transactionInputSchema.optional(),
});

export type BotUnderstanding = z.infer<typeof botUnderstandingSchema>;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY");
  return new GoogleGenAI({ apiKey });
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return JSON");
  return match[0];
}

export async function understandMessageFromText(message: string): Promise<BotUnderstanding> {
  return understandMessage([{ text: message }], message);
}

export async function understandMessageFromAudio(audio: Buffer, mimeType: string): Promise<BotUnderstanding> {
  return understandMessage(
    [
      {
        inlineData: {
          mimeType,
          data: audio.toString("base64"),
        },
      },
    ],
    "",
  );
}

async function understandMessage(parts: unknown[], rawMessage: string): Promise<BotUnderstanding> {
  const ai = getClient();
  const today = new Date().toISOString().slice(0, 10);
  const currency = process.env.DEFAULT_CURRENCY || "COP";
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const contents = [
    {
      role: "user",
      parts: [
        {
          text: `Eres un asistente financiero para Telegram.
Devuelve exclusivamente JSON valido con esta forma:
{
  "intent": "greeting|help|add_transaction|summary|recent|unknown",
  "clear": boolean,
  "reason": "motivo corto si no esta claro",
  "reply": "respuesta breve si no se va a registrar una transaccion",
  "summary": "frase corta para pedir confirmacion",
  "limit": 5,
  "transaction": {
    "date": "YYYY-MM-DD",
    "kind": "expense|income|transfer|adjustment",
    "amount": number,
    "currency": "${currency}",
    "category": "categoria corta",
    "description": "descripcion clara",
    "source": "telegram",
    "transcript": "transcripcion o texto original",
    "confidence": number
  }
}

Reglas:
- Hoy es ${today}.
- Primero identifica la intencion del usuario.
- Usa intent="greeting" para saludos como hola, buenas, hey.
- Usa intent="help" si pregunta que puedes hacer, comandos o ayuda.
- Usa intent="summary" si pide saldo, balance, total, resumen, ingresos o gastos.
- Usa intent="recent" si pide ultimos movimientos, historial o listado. Ajusta limit si pide una cantidad.
- Usa intent="add_transaction" solo si quiere registrar un gasto, ingreso, transferencia o ajuste.
- Usa intent="unknown" si no entiendes la intencion.
- Para greeting, help, summary y recent no incluyas transaction; clear puede ser true.
- Para add_transaction, si falta monto, tipo de movimiento o descripcion util, usa clear=false.
- Si el usuario dice "gaste", "pague", "compre" o similar, es expense.
- Si dice "me pagaron", "recibi", "ingreso", "salario" o similar, es income.
- Si dice "transferi", "pase plata", "mande a otra cuenta" o similar, es transfer.
- Si no hay moneda explicita, usa ${currency}.
- No inventes datos criticos; pide aclaracion con reason.
- confidence debe estar entre 0 y 1.
- Escribe respuestas en espanol natural y corto.
- Ejemplo saludo: {"intent":"greeting","clear":true,"reply":"Hola. Puedo registrar gastos e ingresos por texto o audio. Tambien puedo mostrar resumen y ultimos movimientos.","summary":"","limit":5}
- Ejemplo ayuda: {"intent":"help","clear":true,"reply":"Puedes decir: gaste 25000 en almuerzo, recibi 100000 de salario, resumen, ultimos 5 movimientos.","summary":"","limit":5}
${rawMessage ? `Texto recibido: ${rawMessage}` : "Interpreta el audio adjunto."}`,
        },
        ...parts,
      ],
    },
  ];

  const response = await ai.models.generateContent({
    model,
    contents: contents as never,
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const parsed = botUnderstandingSchema.parse(JSON.parse(extractJson(response.text ?? "")));
  if (parsed.intent !== "add_transaction") {
    return parsed;
  }

  if (!parsed.clear || !parsed.transaction) {
    return {
      intent: "add_transaction",
      clear: false,
      reason: parsed.reason || "No pude identificar con seguridad el movimiento.",
      reply: "",
      summary: "",
      limit: 5,
    };
  }

  return botUnderstandingSchema.parse({
    ...parsed,
    transaction: {
      ...parsed.transaction,
      currency: parsed.transaction.currency || currency,
      source: "telegram",
      transcript: parsed.transaction.transcript || rawMessage,
    } satisfies TransactionInput,
  });
}
