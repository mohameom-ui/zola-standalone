import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Zola — Companion Console", description: "Zola's humanoid companion and flight control console." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
