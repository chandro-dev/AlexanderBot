const groqTranscriptionUrl = "https://api.groq.com/openai/v1/audio/transcriptions";

export function canUseGroqTranscription() {
  return Boolean(process.env.GROQ_API_KEY);
}

export async function transcribeAudioWithGroq(audio: Buffer, mimeType: string) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const model = process.env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo";
  const extension = extensionFromMimeType(mimeType);
  const audioBytes = new Uint8Array(audio);
  const form = new FormData();
  form.append("model", model);
  form.append("response_format", "json");
  form.append("language", process.env.TRANSCRIPTION_LANGUAGE || "es");
  form.append("file", new Blob([audioBytes], { type: mimeType || "audio/ogg" }), `telegram-audio.${extension}`);

  const response = await fetch(groqTranscriptionUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const payload = (await response.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Groq transcription failed: ${response.status}`);
  }

  if (!payload.text?.trim()) {
    throw new Error("Groq transcription returned empty text");
  }

  return payload.text.trim();
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  return "ogg";
}
