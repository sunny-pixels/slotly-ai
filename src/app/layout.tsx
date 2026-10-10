import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], display: "swap", weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "Slotly AI — Book smarter. Never double-book.", template: "%s · Slotly AI" },
  description: "Intelligent service booking with live availability, database-guaranteed reservations and a grounded AI booking assistant.",
};

export const viewport: Viewport = {
  themeColor: "#153C35",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${manrope.variable} antialiased`}>
      <body className="min-h-dvh">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!rounded-md !border !border-line !bg-surface !text-ink !shadow-pop !font-sans",
              description: "!text-ink-muted",
              error: "!border-danger/30",
              success: "!border-success/30",
            },
          }}
        />
      </body>
    </html>
  );
}
