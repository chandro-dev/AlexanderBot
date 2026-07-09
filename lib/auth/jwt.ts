const sessionCookieName = "appfinanzas_session";
const defaultTtlSeconds = 60 * 60 * 12;

type SessionPayload = {
  sub: "appfinanzas";
  iat: number;
  exp: number;
};

export { sessionCookieName };

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error("Missing JWT_SECRET or secret is too short");
  }

  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(ttlSeconds = defaultTtlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: SessionPayload = {
    sub: "appfinanzas",
    iat: now,
    exp: now + ttlSeconds,
  };

  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token?: string) {
  if (!token) return false;

  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return false;

  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = Uint8Array.from(
    atob(encodedSignature.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encodedSignature.length / 4) * 4, "=")),
    (char) => char.charCodeAt(0),
  );

  const validSignature = await crypto.subtle.verify("HMAC", await signingKey(), signature, new TextEncoder().encode(unsigned));
  if (!validSignature) return false;

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<SessionPayload>;
  const now = Math.floor(Date.now() / 1000);
  return payload.sub === "appfinanzas" && typeof payload.exp === "number" && payload.exp > now;
}
