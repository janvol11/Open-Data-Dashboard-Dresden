import type { Metadata } from "next";
import { JetBrains_Mono, Geist } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const DESCRIPTION =
  "Offene Geodaten der Landeshauptstadt Dresden auf der Karte erkunden, auswerten und als Link teilen.";

// Basis für absolute Bild-URLs in Link-Vorschauen; Vercel setzt die Variable
// auf die Produktionsdomain, lokal gilt der Entwicklungsserver
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://127.0.0.1:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Dresden Data Workspace",
  description: DESCRIPTION,
  openGraph: {
    title: "Dresden Data Workspace",
    description: DESCRIPTION,
    locale: "de_DE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dresden Data Workspace",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className={`${geist.variable} ${jetbrainsMono.variable} font-sans antialiased min-h-screen w-full bg-background text-foreground`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
