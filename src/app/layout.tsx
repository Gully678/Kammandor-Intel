import type { Metadata, Viewport } from "next";
import ErrorBoundary from '@/components/ErrorBoundary';
import { BRAND } from '@/config/brand';
import "./globals.css";

export const viewport: Viewport = {
  themeColor: BRAND.colors.gold,
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  keywords: [
    "investment intelligence", "private capital", "OSINT", "open source intelligence",
    "deal intelligence", "counterparty screening", "sanctions screening",
    "real-time intelligence", "geospatial intelligence", "GEOINT",
    "flight tracking", "maritime tracking", "market intelligence",
    "risk monitoring", "threat intelligence", "family office",
    "kammandor", "intel.kammandor.com",
  ],
  authors: [{ name: "Kammandor Intel", url: BRAND.url }],
  creator: "Kammandor Intel",
  publisher: "Kammandor Intel",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
  },
  manifest: "/site.webmanifest",
  alternates: {
    canonical: BRAND.url,
  },
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    type: "website",
    siteName: BRAND.name,
    locale: "en_US",
    url: BRAND.url,
    images: [
      {
        url: `/og-image.png`,
        width: 1200,
        height: 630,
        alt: `${BRAND.name} — ${BRAND.tagline}`,
        type: "image/png",
      },
    ],
  },
  category: "technology",
  classification: "Investment Intelligence",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": BRAND.short,
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": BRAND.colors.ink,
    "msapplication-config": "none",
  },
};

// JSON-LD Structured Data
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: BRAND.name,
  alternateName: [BRAND.short],
  url: BRAND.url,
  description: BRAND.description,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires a modern web browser",
  author: {
    "@type": "Organization",
    name: BRAND.name,
    url: BRAND.url,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr">
      <head>
        {/* Kammandor fonts loaded via CSS in globals.css */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="canonical" href={BRAND.url} />

        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="antialiased">
        <ErrorBoundary name="Kammandor Intel Core">
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
