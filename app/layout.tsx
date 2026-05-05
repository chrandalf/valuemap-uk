import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const GA_ID = "G-SWQGGBXVH6";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UK House Price Map | Grid-Based Property Prices by Area",
  description:
    "Explore UK house prices on an interactive grid map using 1 mile – 15 mile areas. View median prices and recent changes based on Land Registry data.",
  openGraph: {
    title: "UK House Price Map | Grid-Based Property Prices by Area",
    description:
      "Explore UK house prices on an interactive grid map using 1 mile – 15 mile areas. View median prices and recent changes based on Land Registry data.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "UK House Price Map | Grid-Based Property Prices by Area",
    description:
      "Explore UK house prices on an interactive grid map using 1 mile – 15 mile areas. View median prices and recent changes based on Land Registry data.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Google tag (gtag.js) */}
        <Script
          async
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `}
        </Script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

