# App Finanzas

Aplicacion Next.js para registrar gastos e ingresos en un archivo Excel desde un bot de Telegram. El bot recibe audio o texto, usa un modelo para interpretar el movimiento, pide confirmacion y solo despues escribe en `finanzas.xlsx`.

## Arquitectura

- `app/api/telegram/webhook`: webhook del bot. Descarga audio de Telegram, llama al modelo y gestiona confirmacion.
- `lib/ai`: contrato de extraccion con Gemini y salida JSON validada.
- `lib/domain`: esquemas `zod` para movimientos y operaciones pendientes.
- `lib/storage`: lectura/escritura de Excel y almacenamiento de pendientes.
- `app/page.tsx`: frontend simple para ver, editar, guardar y descargar el Excel.

En local se guarda en `./data`. En Vercel se usa Vercel Blob si existe `BLOB_READ_WRITE_TOKEN`, porque el filesystem de funciones serverless no es persistente.

## Modelo recomendado

Para empezar recomiendo este enrutamiento:

- Texto y clasificacion: `gemini-2.5-flash-lite`, con fallback a `gemini-2.5-flash`.
- Audio largo: Groq `whisper-large-v3-turbo` para transcripcion, luego Gemini solo procesa texto.

Esto baja el consumo de audio en Gemini y reparte limites entre proveedores. Si no configuras `GROQ_API_KEY`, la app mantiene el fallback de audio directo con Gemini.

## Configuracion local

```bash
npm install
copy .env.example .env.local
npm run dev
```

Completa en `.env.local`:

- `TELEGRAM_BOT_TOKEN`: token de BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: secreto propio para validar que Telegram llama el webhook.
- `GEMINI_API_KEY`: API key de Google AI Studio.
- `GEMINI_MODELS`: modelos de Gemini en orden de intento, por ejemplo `gemini-2.5-flash-lite,gemini-2.5-flash`.
- `GROQ_API_KEY`: opcional, recomendado para transcribir audios largos.
- `GROQ_TRANSCRIPTION_MODEL`: por defecto `whisper-large-v3-turbo`.
- `DEFAULT_CURRENCY`: por defecto `COP`.

## Configurar webhook de Telegram

Cuando despliegues en Vercel, ejecuta:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" ^
  -d "url=https://TU_DOMINIO.vercel.app/api/telegram/webhook" ^
  -d "secret_token=TU_TELEGRAM_WEBHOOK_SECRET"
```

En Windows PowerShell tambien puedes usar:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot<TOKEN>/setWebhook" `
  -Body @{
    url = "https://TU_DOMINIO.vercel.app/api/telegram/webhook"
    secret_token = "TU_TELEGRAM_WEBHOOK_SECRET"
  }
```

## Flujo del bot

1. El usuario envia audio o texto: "gaste 25000 en almuerzo".
2. El modelo devuelve JSON con `kind`, `amount`, `category`, `description`, `date`, `confidence` y transcripcion.
3. Si falta informacion critica, el bot responde que no fue claro.
4. Si esta claro, el bot resume lo que va a guardar y pide confirmacion.
5. Solo al responder `si`, `sí`, `confirmar`, `ok`, `dale` o `guardar` se agrega la fila al Excel.

## Auditoria

Cada fila conserva:

- `source`: `telegram` o `manual`.
- `transcript`: texto original o transcripcion generada.
- `confidence`: confianza reportada por el modelo.
- `createdAt` y `updatedAt`.

Esto permite revisar por que se creo un registro y corregirlo desde el frontend.
