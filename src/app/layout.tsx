import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MessagingMatrix",
  description: "Matrix-driven messaging workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
