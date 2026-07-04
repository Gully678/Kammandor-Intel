import type { Metadata } from "next";

// Self-hosted fonts (Fontsource) — deterministic builds, no runtime Google request.
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "Kammandor Intelligence — The Governed Intelligence Layer",
  description:
    "The governed intelligence layer that turns your data into signals you can trust — and act on. AI does the watching; a person approves every change; every answer shows its sources. Start free, run it yourself, grow into managed.",
  openGraph: {
    title: "Kammandor Intelligence — See it coming.",
    description:
      "Your data, connected — with a receipt behind every fact. AI does the watching; a person approves every change.",
    type: "website",
    locale: "en_GB",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
