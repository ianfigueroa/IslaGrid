import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
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

// Bootstrap theme before paint — defaults to light (the Windy-style civic
// feel). Users can pin dark via the toggle; their pin overrides the auto.
const THEME_BOOTSTRAP = `(function(){
  try {
    var stored = localStorage.getItem('islagrid-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable}`} suppressHydrationWarning>
      <head>
        <script
          // Run before paint so the first frame already has the right theme.
          // Next 16 warns on next/script with inline children; an inline
          // <script dangerouslySetInnerHTML> in <head> is the supported path.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
      </head>
      <body className="font-sans">
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
