import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { TopNav } from "@/components/TopNav";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RomM Downloader",
  description: "Browse a game catalog, acquire via TorBox, and push into RomM.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-screen">
        <TopNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
