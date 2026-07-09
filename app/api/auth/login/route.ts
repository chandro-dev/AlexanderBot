import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieName } from "@/lib/auth/jwt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  const expectedPassword = process.env.AUTH_PASSWORD;

  if (!expectedPassword || !password || password !== expectedPassword) {
    return NextResponse.json({ ok: false, error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}
