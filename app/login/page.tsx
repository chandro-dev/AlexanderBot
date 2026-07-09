"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (!response.ok) {
      setError("Contraseña incorrecta.");
      return;
    }

    window.location.href = "/";
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <span className="eyebrow">Acceso privado</span>
        <h1>App Finanzas</h1>
        <p className="subtitle">Ingresa la contraseña única del sistema para administrar tus movimientos.</p>
        <label className="login-label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          autoFocus
          className="login-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Contraseña del sistema"
        />
        {error ? <p className="login-error">{error}</p> : null}
        <button className="button primary login-button" disabled={loading || !password}>
          {loading ? "Validando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
