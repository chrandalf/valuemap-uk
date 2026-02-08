import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
    "Explore UK house prices on an interactive grid map using 1km–25km areas. View median prices and recent changes based on Land Registry data.",
  openGraph: {
    title: "UK House Price Map | Grid-Based Property Prices by Area",
    description:
      "Explore UK house prices on an interactive grid map using 1km–25km areas. View median prices and recent changes based on Land Registry data.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "UK House Price Map | Grid-Based Property Prices by Area",
    description:
      "Explore UK house prices on an interactive grid map using 1km–25km areas. View median prices and recent changes based on Land Registry data.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

