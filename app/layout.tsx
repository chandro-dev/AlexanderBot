import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "App Finanzas",
  description: "Registro auditable de gastos e ingresos desde Telegram.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
