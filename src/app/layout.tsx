import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";
import { getActiveLookAndFeel, lookAndFeelToCssVars } from "@/lib/branding";

export const metadata: Metadata = {
  title: "MessagingMatrix",
  description: "Matrix-driven messaging workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const laf = getActiveLookAndFeel();
  const style = lookAndFeelToCssVars(laf) as CSSProperties;
  return (
    <html lang="en" style={style}>
      <body>{children}</body>
    </html>
  );
}
