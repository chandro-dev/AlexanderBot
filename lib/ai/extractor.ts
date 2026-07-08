import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { transactionInputSchema, type TransactionInput } from "@/lib/domain/transaction";

const extractionSchema = z.object({
  clear: z.boolean(),
  reason: z.string().default(""),
  summary: z.string().default(""),
  transaction: transactionInputSchema.optional(),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;

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

export async function extractTransactionFromText(message: string): Promise<ExtractionResult> {
  return extractTransaction([{ text: message }], message);
}

export async function extractTransactionFromAudio(audio: Buffer, mimeType: string): Promise<ExtractionResult> {
  return extractTransaction(
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

async function extractTransaction(parts: unknown[], rawMessage: string): Promise<ExtractionResult> {
  const ai = getClient();
  const today = new Date().toISOString().slice(0, 10);
  const currency = process.env.DEFAULT_CURRENCY || "COP";
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const contents = [
    {
      role: "user",
      parts: [
        {
          text: `Eres un clasificador contable para finanzas personales.
Devuelve exclusivamente JSON valido con esta forma:
{
  "clear": boolean,
  "reason": "motivo corto si no esta claro",
  "summary": "frase corta para pedir confirmacion",
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
- Si falta monto, tipo de movimiento o descripcion util, usa clear=false.
- Si el usuario dice "gaste", "pague", "compre" o similar, es expense.
- Si dice "me pagaron", "recibi", "ingreso", "salario" o similar, es income.
- Si no hay moneda explicita, usa ${currency}.
- No inventes datos criticos; pide aclaracion con reason.
- confidence debe estar entre 0 y 1.
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

  const parsed = extractionSchema.parse(JSON.parse(extractJson(response.text ?? "")));
  if (!parsed.clear || !parsed.transaction) {
    return {
      clear: false,
      reason: parsed.reason || "No pude identificar con seguridad el movimiento.",
      summary: "",
    };
  }

  return extractionSchema.parse({
    ...parsed,
    transaction: {
      ...parsed.transaction,
      currency: parsed.transaction.currency || currency,
      source: "telegram",
      transcript: parsed.transaction.transcript || rawMessage,
    } satisfies TransactionInput,
  });
}
