"use client";

import { useEffect, useMemo, useState } from "react";
import { transactionCategories } from "@/lib/domain/categories";
import { summarizeTransactions, transactionKinds, type Transaction } from "@/lib/domain/transaction";

type ApiPayload = {
  transactions: Transaction[];
};

const moneyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function newRow(): Transaction {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    date: today(),
    kind: "expense",
    amount: 0,
    currency: "COP",
    category: "",
    description: "",
    source: "manual",
    transcript: "",
    confidence: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [status, setStatus] = useState("Cargando movimientos...");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);

  useEffect(() => {
    void loadTransactions();
  }, []);

  async function loadTransactions() {
    setError("");
    const response = await fetch("/api/transactions", { cache: "no-store" });
    if (!response.ok) {
      setError("No pude cargar el Excel.");
      return;
    }
    const payload = (await response.json()) as ApiPayload;
    setTransactions(payload.transactions);
    setStatus(payload.transactions.length ? "Movimientos cargados." : "Aun no hay movimientos.");
  }

  function patchRow(id: string, patch: Partial<Transaction>) {
    setTransactions((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  }

  async function save() {
    setSaving(true);
    setError("");

    const response = await fetch("/api/transactions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactions }),
    });

    setSaving(false);

    if (!response.ok) {
      setError("No pude guardar. Revisa que monto, fecha, categoria y descripcion sean validos.");
      return;
    }

    const payload = (await response.json()) as ApiPayload;
    setTransactions(payload.transactions);
    setStatus("Excel actualizado.");
  }

  function removeRow(id: string) {
    setTransactions((current) => current.filter((item) => item.id !== id));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const lastUpdated = transactions[0]?.updatedAt
    ? new Intl.DateTimeFormat("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(transactions[0].updatedAt))
    : "Sin registros";

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Control financiero</span>
          <h1>Finanzas</h1>
          <p className="subtitle">Audita, corrige y descarga los movimientos que llegan desde Telegram.</p>
          <div className="hero-meta">
            <span>Ultima actualizacion: {lastUpdated}</span>
            <span>{summary.count} registros</span>
          </div>
        </div>
        <div className="actions">
          <button className="button" onClick={() => setTransactions((rows) => [newRow(), ...rows])}>
            Nuevo
          </button>
          <button className="button primary" onClick={save} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
          <a className="button" href="/api/excel">
            Descargar Excel
          </a>
          <button className="button" onClick={logout}>
            Salir
          </button>
        </div>
      </section>

      <section className="summary" aria-label="Resumen">
        <div className="metric income">
          <span>Ingresos</span>
          <strong>{moneyFormatter.format(summary.income)}</strong>
        </div>
        <div className="metric expense">
          <span>Gastos</span>
          <strong>{moneyFormatter.format(summary.expenses)}</strong>
        </div>
        <div className={`metric ${summary.balance >= 0 ? "income" : "expense"}`}>
          <span>Balance</span>
          <strong>{moneyFormatter.format(summary.balance)}</strong>
        </div>
        <div className="metric neutral">
          <span>Registros</span>
          <strong>{summary.count}</strong>
        </div>
      </section>

      <p className={`status ${error ? "error" : "ok"}`}>{error || status}</p>

      <section className="table-wrap">
        {transactions.length === 0 ? (
          <div className="empty">No hay registros. Agrega uno manualmente o envia un audio al bot.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Monto</th>
                <th>Moneda</th>
                <th>Categoria</th>
                <th>Descripcion</th>
                <th>Fuente</th>
                <th>Conf.</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input type="date" value={item.date} onChange={(event) => patchRow(item.id, { date: event.target.value })} />
                  </td>
                  <td>
                    <select value={item.kind} onChange={(event) => patchRow(item.id, { kind: event.target.value as Transaction["kind"] })}>
                      {transactionKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="money"
                      type="number"
                      min="0"
                      step="1"
                      value={item.amount}
                      onChange={(event) => patchRow(item.id, { amount: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input value={item.currency} onChange={(event) => patchRow(item.id, { currency: event.target.value.toUpperCase() })} />
                  </td>
                  <td>
                    <select value={item.category} onChange={(event) => patchRow(item.id, { category: event.target.value })}>
                      <option value="">Seleccionar</option>
                      {transactionCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                      {!transactionCategories.includes(item.category as (typeof transactionCategories)[number]) && item.category ? (
                        <option value={item.category}>{item.category}</option>
                      ) : null}
                    </select>
                  </td>
                  <td>
                    <input value={item.description} onChange={(event) => patchRow(item.id, { description: event.target.value })} />
                  </td>
                  <td>
                    <span className={`badge ${item.source}`}>{item.source}</span>
                  </td>
                  <td>
                    <span className="confidence">{Math.round(item.confidence * 100)}%</span>
                  </td>
                  <td>
                    <button className="button danger-button" onClick={() => removeRow(item.id)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
