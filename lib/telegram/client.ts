type TelegramFile = {
  ok: boolean;
  result?: {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
  };
  description?: string;
};

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return token;
}

function apiUrl(method: string) {
  return `https://api.telegram.org/bot${botToken()}/${method}`;
}

export async function sendTelegramMessage(chatId: string | number, text: string) {
  const response = await fetch(apiUrl("sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`);
  }
}

export async function downloadTelegramFile(fileId: string) {
  const fileResponse = await fetch(apiUrl(`getFile?file_id=${encodeURIComponent(fileId)}`));
  const fileData = (await fileResponse.json()) as TelegramFile;

  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error(fileData.description || "Telegram getFile failed");
  }

  const fileUrl = `https://api.telegram.org/file/bot${botToken()}/${fileData.result.file_path}`;
  const audioResponse = await fetch(fileUrl);
  if (!audioResponse.ok) throw new Error(`Telegram file download failed: ${audioResponse.status}`);

  const contentType = audioResponse.headers.get("content-type") || "audio/ogg";
  return {
    buffer: Buffer.from(await audioResponse.arrayBuffer()),
    contentType,
  };
}

export function assertTelegramSecret(request: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return;

  const received = request.headers.get("x-telegram-bot-api-secret-token");
  if (received !== expected) {
    throw new Error("Invalid Telegram webhook secret");
  }
}
