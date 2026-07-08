import { GoogleGenAI } from "@google/genai";
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
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return JSON");
  return match[0];
}

export async function understandMessageFromText(message: string): Promise<BotUnderstanding> {
  const ruleBased = understandTransactionWithRules(message);
  if (ruleBased) return ruleBased;
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
- Si el usuario dice "gaste", "gasté", "pague", "pagué", "compre", "compré", "me costo", "me costó", "salio" o similar, es expense.
- Si dice "me pagaron", "me pago", "me pagó", "recibi", "recibí", "ingreso", "entraron", "cobre", "cobré", "salario", "nomina" o similar, es income.
- Si dice "transferi", "pase plata", "mande a otra cuenta" o similar, es transfer.
- Si no hay moneda explicita, usa ${currency}.
- Usa preferiblemente una de estas categorias:
${categories}
- No inventes datos criticos; pide aclaracion con reason.
- confidence debe estar entre 0 y 1.
- Escribe respuestas en espanol natural y corto.
- Ejemplo saludo: {"intent":"greeting","clear":true,"reply":"Hola. Puedo registrar gastos e ingresos por texto o audio. Tambien puedo mostrar resumen y ultimos movimientos.","summary":"","limit":5}
- Ejemplo ayuda: {"intent":"help","clear":true,"reply":"Puedes decir: gaste 25000 en almuerzo, recibi 100000 de salario, resumen, ultimos 5 movimientos.","summary":"","limit":5}
- Ejemplo gasto: {"intent":"add_transaction","clear":true,"reply":"","summary":"Voy a registrar un gasto de 25000 ${currency} en Alimentacion por almuerzo.","limit":5,"transaction":{"date":"${today}","kind":"expense","amount":25000,"currency":"${currency}","category":"Alimentacion","description":"almuerzo","source":"telegram","transcript":"gaste 25000 en almuerzo","confidence":0.92}}
- Ejemplo ingreso: {"intent":"add_transaction","clear":true,"reply":"","summary":"Voy a registrar un ingreso de 100000 ${currency} en Salario.","limit":5,"transaction":{"date":"${today}","kind":"income","amount":100000,"currency":"${currency}","category":"Salario","description":"salario","source":"telegram","transcript":"recibi 100000 de salario","confidence":0.92}}
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

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function understandTransactionWithRules(message: string): BotUnderstanding | null {
  const normalized = normalizeText(message);
  const kind = isIncomeText(normalized) ? "income" : isExpenseText(normalized) ? "expense" : null;
  if (!kind) return null;

  const amount = extractAmount(normalized);
  if (!amount) {
    return {
      intent: "add_transaction",
      clear: false,
      reason: "Identifique el tipo de movimiento, pero falta el monto.",
      reply: "",
      summary: "",
      limit: 5,
    };
  }

  const currency = process.env.DEFAULT_CURRENCY || "COP";
  const description = extractDescription(normalized) || (kind === "expense" ? "gasto" : "ingreso");
  const category = guessCategory(kind, normalized);
  const date = new Date().toISOString().slice(0, 10);

  return botUnderstandingSchema.parse({
    intent: "add_transaction",
    clear: true,
    reason: "",
    reply: "",
    summary:
      kind === "expense"
        ? `Voy a registrar un gasto de ${amount} ${currency} en ${category} por ${description}.`
        : `Voy a registrar un ingreso de ${amount} ${currency} en ${category} por ${description}.`,
    limit: 5,
    transaction: {
      date,
      kind,
      amount,
      currency,
      category,
      description,
      source: "telegram",
      transcript: message,
      confidence: 0.9,
    },
  });
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
