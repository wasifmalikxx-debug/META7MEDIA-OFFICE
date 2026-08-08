import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Inter is the interface face (Aug 2026 redesign). Geist Mono stays for
// figures and IDs — payroll amounts and employee IDs need tabular alignment.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Applies the saved theme BEFORE first paint.
 *
 * Without this the page always renders light and then snaps to dark once
 * React hydrates — a white flash on every navigation for dark-mode users.
 * Kept as a raw string so it runs synchronously in <head>; it mirrors
 * exactly what the header toggle writes to localStorage.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export const metadata: Metadata = {
  title: "META7MEDIA AI — Office Manager",
  description: "Office attendance, payroll, and employee management system — Powered by Google",
  // No `icons` here on purpose. Next serves src/app/favicon.ico and
  // src/app/icon.png by file convention, and both now hold the META7MEDIA
  // "M". Declaring icons in metadata as well emits a second, competing
  // <link rel="icon">, and the one it used to point at (/logo.png) was the
  // untrimmed 1563px square — the wordmark floating in ~78% empty padding,
  // which shrank to an unreadable smudge in a 16px tab.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
