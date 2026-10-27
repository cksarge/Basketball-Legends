import type { Metadata, Viewport } from "next";
import { Barlow, Big_Shoulders } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/ui/AppProviders";
import { SITE_URL } from "@/lib/site";

const display = Big_Shoulders({ subsets: ["latin"], variable: "--font-big-shoulders", weight: ["500", "700", "800", "900"], display: "swap" });
const body = Barlow({ subsets: ["latin"], variable: "--font-barlow", weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Basketball Legends", template: "%s · Basketball Legends" },
  description:
    "A free 3D basketball game in your browser. Play Arizona high school, college and pro basketball, build a career from freshman year to the Hall of Fame, or run a franchise.",
  applicationName: "Basketball Legends",
  keywords: ["basketball game", "browser game", "3D basketball", "career mode", "franchise mode", "Arizona high school basketball"],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Basketball Legends",
    title: "Basketball Legends",
    description: "Free 3D basketball in your browser: career, franchise and quick play.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Basketball Legends" }],
  },
  twitter: { card: "summary_large_image", title: "Basketball Legends", description: "Free 3D basketball in your browser.", images: ["/og.png"] },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0d1b2e",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
