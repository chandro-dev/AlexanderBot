import { GoogleGenAI } from "@google/genai";
import { canUseGroqTranscription, transcribeAudioWithGroq } from "@/lib/ai/groq";
import { z } from "zod";
import { categoriesForPrompt, expenseCategories, incomeCategories } from "@/lib/domain/categories";
import { transactionInputSchema, type TransactionInput } from "@/lib/domain/transaction";

const botUnderstandingSchema = z.object({
  intent: z.enum(["greeting", "help", "add_transaction", "summary", "recent", "unknown"]),
  clear: z.boolean(),
  reason: z.string().default(""),
  reply: z.string().default(""),
  summary: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  transaction: transactionInputSchema.optional(),
  transactions: z.array(transactionInputSchema).optional(),
});

export type BotUnderstanding = z.infer<typeof botUnderstandingSchema>;

const expenseWords = [
  "gaste",
  "gastar",
  "gasto",
  "pague",
  "pagar",
  "pago",
  "compre",
  "comprar",
  "compra",
  "me costo",
  "costó",
  "salio",
  "salió",
];

const incomeWords = [
  "recibi",
  "recibir",
  "recibo",
  "me pagaron",
  "me pago",
  "me pagó",
  "ingreso",
  "entraron",
  "cobre",
  "cobré",
  "salario",
  "nomina",
  "nómina",
];

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY");
  return new GoogleGenAI({ apiKey });
}

function extractJson(text: string) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) throw new Error("Model did not return JSON");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) {
      return trimmed.slice(start, index + 1);
    }
  }

  throw new Error("Model returned incomplete JSON");
}

export async function understandMessageFromText(message: string): Promise<BotUnderstanding> {
  const ruleBased = understandTransactionsWithRules(message);
  if (ruleBased) return ruleBased;
  return understandMessage([{ text: message }], message);
}

export async function understandMessageFromAudio(audio: Buffer, mimeType: string): Promise<BotUnderstanding> {
  if (canUseGroqTranscription()) {
    try {
      const transcript = await transcribeAudioWithGroq(audio, mimeType);
      const ruleBased = understandTransactionsWithRules(transcript);
      if (ruleBased) return ruleBased;
      return understandMessage([{ text: transcript }], transcript);
    } catch (error) {
      console.error("Groq transcription failed, falling back to Gemini audio", error);
    }
  }

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
  const models = geminiModels();
  const categories = categoriesForPrompt();

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
  },
  "transactions": []
}

Reglas:
- Devuelve un solo objeto JSON. No uses Markdown. No agregues texto antes ni despues.
- Hoy es ${today}.
- Primero identifica la intencion del usuario.
- Usa intent="greeting" para saludos como hola, buenas, hey.
- Usa intent="help" si pregunta que puedes hacer, comandos o ayuda.
- Usa intent="summary" si pide saldo, balance, total, resumen, ingresos o gastos.
- Usa intent="recent" si pide ultimos movimientos, historial o listado. Ajusta limit si pide una cantidad.
- Usa intent="add_transaction" solo si quiere registrar un gasto, ingreso, transferencia o ajuste.
- Si el usuario menciona varios movimientos, llena "transactions" con todos. Tambien puedes llenar "transaction" con el primero.
- Usa intent="unknown" si no entiendes la intencion.
- Para greeting, help, summary y recent no incluyas transaction; clear puede ser true.
- Para add_transaction, si falta monto, tipo de movimiento o descripcion util, usa clear=false.
- Si el usuario dice "gaste", "gasté", "pague", "pagué", "compre", "compré", "me costo", "me costó", "salio" o similar, es expense.
- Si dice "me pagaron", "me pago", "me pagó", "recibi", "recibí", "ingreso", "entraron", "cobre", "cobré", "salario", "nomina" o similar, es income.
- Si dice "transferi", "pase plata", "mande a otra cuenta" o similar, es transfer.
- Si no hay moneda explicita, usa ${currency}.
- Usa preferiblemente una de estas categorias:
${categories}
- No inventes datos criticos; pide aclaracion con reason.
- transaction.transcript debe ser corto, maximo 300 caracteres.
- Cada item de transactions debe tener el mismo formato que transaction.
- Extrae maximo 10 movimientos por mensaje o audio. Si hay mas, devuelve los 10 mas claros y explica en summary.
- description debe ser corta, maximo 120 caracteres.
- summary debe ser corta, maximo 180 caracteres.
- confidence debe estar entre 0 y 1.
- Escribe respuestas en espanol natural y corto.
- Ejemplo saludo: {"intent":"greeting","clear":true,"reply":"Hola. Puedo registrar gastos e ingresos por texto o audio. Tambien puedo mostrar resumen y ultimos movimientos.","summary":"","limit":5}
- Ejemplo ayuda: {"intent":"help","clear":true,"reply":"Puedes decir: gaste 25000 en almuerzo, recibi 100000 de salario, resumen, ultimos 5 movimientos.","summary":"","limit":5}
- Ejemplo gasto: {"intent":"add_transaction","clear":true,"reply":"","summary":"Voy a registrar un gasto de 25000 ${currency} en Alimentacion por almuerzo.","limit":5,"transaction":{"date":"${today}","kind":"expense","amount":25000,"currency":"${currency}","category":"Alimentacion","description":"almuerzo","source":"telegram","transcript":"gaste 25000 en almuerzo","confidence":0.92}}
- Ejemplo ingreso: {"intent":"add_transaction","clear":true,"reply":"","summary":"Voy a registrar un ingreso de 100000 ${currency} en Salario.","limit":5,"transaction":{"date":"${today}","kind":"income","amount":100000,"currency":"${currency}","category":"Salario","description":"salario","source":"telegram","transcript":"recibi 100000 de salario","confidence":0.92}}
- Ejemplo varios: {"intent":"add_transaction","clear":true,"reply":"","summary":"Encontre 3 movimientos para confirmar.","limit":5,"transactions":[{"date":"${today}","kind":"expense","amount":25000,"currency":"${currency}","category":"Alimentacion","description":"almuerzo","source":"telegram","transcript":"gaste 25000 en almuerzo","confidence":0.9},{"date":"${today}","kind":"expense","amount":12000,"currency":"${currency}","category":"Transporte","description":"taxi","source":"telegram","transcript":"12000 en taxi","confidence":0.88},{"date":"${today}","kind":"income","amount":300000,"currency":"${currency}","category":"Honorarios","description":"cliente","source":"telegram","transcript":"recibi 300000 de un cliente","confidence":0.88}]}
${rawMessage ? `Texto recibido: ${rawMessage}` : "Interpreta el audio adjunto."}`,
        },
        ...parts,
      ],
    },
  ];

  let parsed: BotUnderstanding;
  try {
    const responseText = await generateWithGeminiFallback(ai, models, contents);
    parsed = botUnderstandingSchema.parse(JSON.parse(extractJson(responseText)));
  } catch (error) {
    console.error("Model understanding failed", error);
    return {
      intent: "unknown",
      clear: false,
      reason: "El audio o mensaje fue demasiado largo o no pude estructurarlo.",
      reply: "No pude entenderlo bien. Enviame una frase mas corta, por ejemplo: gaste 25000 en almuerzo.",
      summary: "",
      limit: 5,
    };
  }

  if (parsed.intent !== "add_transaction") {
    return parsed;
  }

  const transactions = normalizeTransactions(parsed, currency, rawMessage);

  if (!parsed.clear || transactions.length === 0) {
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
    transaction: transactions[0],
    transactions,
  });
}

async function generateWithGeminiFallback(ai: GoogleGenAI, models: string[], contents: unknown[]) {
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: contents as never,
        config: {
          temperature: 0.1,
          responseMimeType: "application/json",
          maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 2200),
        },
      });

      return response.text ?? "";
    } catch (error) {
      lastError = error;
      console.error(`Gemini model failed: ${model}`, error);
    }
  }

  throw lastError || new Error("All Gemini models failed");
}

function geminiModels() {
  const configured = process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite,gemini-2.5-flash";
  const models = configured
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length ? models : ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function understandTransactionsWithRules(message: string): BotUnderstanding | null {
  const parts = splitPotentialTransactions(message);
  const transactions = parts
    .map((part) => understandSingleTransactionWithRules(part))
    .filter((item): item is TransactionInput => Boolean(item))
    .slice(0, 10);

  if (transactions.length > 1) {
    return botUnderstandingSchema.parse({
      intent: "add_transaction",
      clear: true,
      reason: "",
      reply: "",
      summary: `Encontre ${transactions.length} movimientos para confirmar.`,
      limit: 5,
      transaction: transactions[0],
      transactions,
    });
  }

  if (transactions.length === 1) {
    const item = transactions[0];
    return botUnderstandingSchema.parse({
      intent: "add_transaction",
      clear: true,
      reason: "",
      reply: "",
      summary:
        item.kind === "expense"
          ? `Voy a registrar un gasto de ${item.amount} ${item.currency} en ${item.category} por ${item.description}.`
          : `Voy a registrar un ingreso de ${item.amount} ${item.currency} en ${item.category} por ${item.description}.`,
      limit: 5,
      transaction: item,
      transactions: [item],
    });
  }

  const normalized = normalizeText(message);
  if ((isIncomeText(normalized) || isExpenseText(normalized)) && !extractAmount(normalized)) {
    return {
      intent: "add_transaction",
      clear: false,
      reason: "Identifique el tipo de movimiento, pero falta el monto.",
      reply: "",
      summary: "",
      limit: 5,
    };
  }

  return null;
}

function understandSingleTransactionWithRules(message: string): TransactionInput | null {
  const normalized = normalizeText(message);
  const kind = isIncomeText(normalized) ? "income" : isExpenseText(normalized) ? "expense" : null;
  if (!kind) return null;

  const amount = extractAmount(normalized);
  if (!amount) return null;

  const currency = process.env.DEFAULT_CURRENCY || "COP";
  const description = extractDescription(normalized) || (kind === "expense" ? "gasto" : "ingreso");
  const category = guessCategory(kind, normalized);
  const date = new Date().toISOString().slice(0, 10);

  return transactionInputSchema.parse({
    date,
    kind,
    amount,
    currency,
    category,
    description,
    source: "telegram",
    transcript: message.trim().slice(0, 300),
    confidence: 0.9,
  });
}

function splitPotentialTransactions(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  const coarseParts = normalized.split(/\s*(?:,|;|\.|\n|\s+y\s+|\s+ademas\s+|\s+tambien\s+)\s*/i);
  const parts = coarseParts.filter((part) => part.trim().length > 0);
  return parts.length ? parts : [message];
}

function normalizeTransactions(parsed: BotUnderstanding, currency: string, rawMessage: string): TransactionInput[] {
  const candidates = parsed.transactions?.length ? parsed.transactions : parsed.transaction ? [parsed.transaction] : [];
  return candidates.slice(0, 10).map((transaction) =>
    transactionInputSchema.parse({
      ...transaction,
      currency: transaction.currency || currency,
      source: "telegram",
      transcript: (transaction.transcript || rawMessage).slice(0, 300),
    }),
  );
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(normalizeText(word)));
}

function isExpenseText(text: string) {
  return includesAny(text, expenseWords) || /\b(gast|pag|compr|cost|sali)/.test(text);
}

function isIncomeText(text: string) {
  return includesAny(text, incomeWords) || /\b(recib|ingres|cobr|salari|nomin|pagaron)/.test(text);
}

function extractAmount(text: string) {
  const match = text.match(/(?:cop|pesos|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s*(mil|k))?/i);
  if (!match) return null;

  const numeric = Number(match[1].replace(/[.,]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return match[2] ? numeric * 1000 : numeric;
}

function extractDescription(text: string) {
  const match = text.match(/\b(?:en|por|de|para)\s+(.+)$/);
  if (!match) return "";
  return match[1].replace(/\b(?:cop|pesos)\b/g, "").trim();
}

function guessCategory(kind: "expense" | "income", text: string) {
  if (kind === "income") {
    if (/\b(salario|nomina|sueldo)\b/.test(text)) return "Salario";
    if (/\b(honorario|freelance|cliente)\b/.test(text)) return "Honorarios";
    if (/\b(venta|vendi|vendí)\b/.test(text)) return "Ventas";
    if (/\b(reembolso|devolucion|devolución)\b/.test(text)) return "Reembolso";
    return incomeCategories[incomeCategories.length - 1];
  }

  if (/\b(almuerzo|comida|desayuno|cena|mercado|restaurante|cafe|café)\b/.test(text)) return "Alimentacion";
  if (/\b(taxi|uber|bus|metro|gasolina|peaje|transporte)\b/.test(text)) return "Transporte";
  if (/\b(arriendo|renta|hipoteca|vivienda)\b/.test(text)) return "Vivienda";
  if (/\b(luz|agua|internet|telefono|teléfono|gas|servicio)\b/.test(text)) return "Servicios";
  if (/\b(medico|médico|medicina|salud|clinica|clínica)\b/.test(text)) return "Salud";
  if (/\b(curso|libro|universidad|colegio|educacion|educación)\b/.test(text)) return "Educacion";
  if (/\b(cine|netflix|spotify|bar|fiesta|entretenimiento)\b/.test(text)) return "Entretenimiento";
  if (/\b(cuota|prestamo|préstamo|deuda|tarjeta)\b/.test(text)) return "Deudas";
  if (/\b(ropa|zapatos|compra|compre|compré)\b/.test(text)) return "Compras";
  return expenseCategories[expenseCategories.length - 1];
}
