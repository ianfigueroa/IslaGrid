import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fira-sans",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-fira-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IslaGrid AI — Puerto Rico Grid Intelligence",
  description:
    "Public, source-labeled view of Puerto Rico's electric grid. Demand, reserves, generation, planned work, community reports.",
  applicationName: "IslaGrid AI",
  authors: [{ name: "IslaGrid AI" }],
  openGraph: {
    title: "IslaGrid AI",
    description: "Public, source-labeled view of Puerto Rico's electric grid.",
    type: "website",
    locale: "en_US",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark light",
};

// Bootstrap theme before paint — avoids the FOUC flash when reloading in light mode.
const THEME_BOOTSTRAP = `(function(){
  try {
    var stored = localStorage.getItem('islagrid-theme');
    var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = stored || (prefersLight ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <Script id="islagrid-theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-text"
        >
          Skip to map
        </a>
        {children}
      </body>
    </html>
  );
}
