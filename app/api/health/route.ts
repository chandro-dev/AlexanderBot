import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      telegramBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      telegramWebhookSecret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
      geminiApiKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      geminiModels: process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite,gemini-2.5-flash",
      groqApiKey: Boolean(process.env.GROQ_API_KEY),
      groqTranscriptionModel: process.env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo",
      blobReadWriteToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      defaultCurrency: process.env.DEFAULT_CURRENCY || "COP",
      storageMode: process.env.BLOB_READ_WRITE_TOKEN
        ? "vercel-blob"
        : process.env.VERCEL
          ? "serverless-tmp"
          : "local-filesystem",
    },
  });
}
