import type { Metadata, Viewport } from "next";
import ErrorBoundary from '@/components/ErrorBoundary';
import { getBrand, resolveBrandKey } from '@/config/brands';
import BrandThemeScript from '@/components/BrandThemeScript';
import "./globals.css";

// Resolve the active brand at build/request time from env (defaults to kammandor).
const activeBrand = getBrand(resolveBrandKey(process.env.INTEL_BRAND));

export const viewport: Viewport = {
  themeColor: activeBrand.colors.gold,
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(activeBrand.url),
  title: {
    default: `${activeBrand.name} — ${activeBrand.tagline}`,
    template: `%s · ${activeBrand.name}`,
  },
  description: activeBrand.description,
  keywords: [
    "investment intelligence", "private capital", "OSINT", "open source intelligence",
    "deal intelligence", "counterparty screening", "sanctions screening",
    "real-time intelligence", "geospatial intelligence", "GEOINT",
    "flight tracking", "maritime tracking", "market intelligence",
    "risk monitoring", "threat intelligence", "family office",
    "kammandor", "intel.kammandor.com",
  ],
  authors: [{ name: activeBrand.name, url: activeBrand.url }],
  creator: activeBrand.name,
  publisher: activeBrand.name,
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
    canonical: activeBrand.url,
  },
  openGraph: {
    title: `${activeBrand.name} — ${activeBrand.tagline}`,
    description: activeBrand.description,
    type: "website",
    siteName: activeBrand.name,
    locale: "en_US",
    url: activeBrand.url,
    images: [
      {
        url: `/og-image.png`,
        width: 1200,
        height: 630,
        alt: `${activeBrand.name} — ${activeBrand.tagline}`,
        type: "image/png",
      },
    ],
  },
  category: "technology",
  classification: "Investment Intelligence",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": activeBrand.short,
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": activeBrand.colors.ink,
    "msapplication-config": "none",
  },
};

// JSON-LD Structured Data
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: activeBrand.name,
  alternateName: [activeBrand.short],
  url: activeBrand.url,
  description: activeBrand.description,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires a modern web browser",
  author: {
    "@type": "Organization",
    name: activeBrand.name,
    url: activeBrand.url,
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
        {/* Brand fonts loaded via CSS in globals.css */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="canonical" href={activeBrand.url} />

        {/* Inject non-default brand CSS vars if INTEL_BRAND env is set */}
        <BrandThemeScript />

        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="antialiased">
        <ErrorBoundary name={`${activeBrand.name} Core`}>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
