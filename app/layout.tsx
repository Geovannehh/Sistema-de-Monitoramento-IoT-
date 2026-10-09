import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "IoT Device Manager | GeoLab",
  description:
    "Dispositivos, telemetria, firmware e comandos remotos para sua infraestrutura IoT.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body>{children}</body>
    </html>
  );
}
