import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "@fontsource-variable/jetbrains-mono";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Offene Geodaten der Landeshauptstadt Dresden auf der Karte erkunden, auswerten und als Link teilen.";

export const metadata: Metadata = {
  metadataBase: new URL("http://127.0.0.1:3000"),
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
    <html lang="de" suppressHydrationWarning className={cn("font-sans", GeistSans.variable)}>
      <body className="font-sans antialiased min-h-screen w-full bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
