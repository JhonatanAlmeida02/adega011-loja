import type { Metadata, Viewport } from "next";
import { Anton, DM_Sans, Space_Mono } from "next/font/google";
import { RegistrarSW } from "@/components/registrar-sw";
import { Notificacoes } from "@/components/tema/notificacoes";
import { SCRIPT_TEMA } from "@/lib/tema";
import "./globals.css";

const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Adega011 · São Paulo no copo",
    template: "%s · Adega011",
  },
  description:
    "Vinhos, destilados, cervejas e combos com entrega rápida em Itatiba e região. Monte seu pedido pelo celular e envie pelo WhatsApp.",
  applicationName: "Adega011",
  keywords: ["adega", "adega em Itatiba", "delivery de bebidas", "Itatiba", "vinhos", "destilados", "cervejas", "combos"],
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Adega011",
    title: "Adega011 · São Paulo no copo",
    description: "Vinhos, destilados, cervejas e combos. Peça pelo WhatsApp.",
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "/" },
  appleWebApp: { capable: true, title: "Adega011", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0B",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${anton.variable} ${dmSans.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <RegistrarSW />
        <Notificacoes />
      </body>
    </html>
  );
}
