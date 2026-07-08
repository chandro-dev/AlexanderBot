export const expenseCategories = [
  "Alimentacion",
  "Transporte",
  "Vivienda",
  "Servicios",
  "Salud",
  "Educacion",
  "Compras",
  "Entretenimiento",
  "Deudas",
  "Impuestos",
  "Mascotas",
  "Viajes",
  "Otros gastos",
] as const;

export const incomeCategories = [
  "Salario",
  "Honorarios",
  "Ventas",
  "Rendimientos",
  "Reembolso",
  "Regalo",
  "Otros ingresos",
] as const;

export const transferCategories = ["Transferencia", "Ahorro", "Inversion"] as const;

export const adjustmentCategories = ["Ajuste", "Correccion"] as const;

export const transactionCategories = [
  ...expenseCategories,
  ...incomeCategories,
  ...transferCategories,
  ...adjustmentCategories,
] as const;

export function categoriesForPrompt() {
  return [
    `expense: ${expenseCategories.join(", ")}`,
    `income: ${incomeCategories.join(", ")}`,
    `transfer: ${transferCategories.join(", ")}`,
    `adjustment: ${adjustmentCategories.join(", ")}`,
  ].join("\n");
}
