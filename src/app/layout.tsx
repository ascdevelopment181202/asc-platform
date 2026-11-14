import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASC Platform",
  description: "ASC Development client onboarding and delivery",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
