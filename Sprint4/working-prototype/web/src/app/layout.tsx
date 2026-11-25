import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  title: "II ∞ · Clínica",
  description: "Sistema de agendamento inteligente para clínicas",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Apply the saved light/dark choice before first paint (no flash). */}
        <Script id="theme-no-flash" strategy="beforeInteractive">
          {
            "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}"
          }
        </Script>
        {children}
        {/* Dev-build indicator — visible on every page. */}
        <div className="pointer-events-none fixed bottom-2 right-3 z-50 rounded-full bg-amber-500/90 px-3 py-1 text-[11px] font-medium text-white shadow-md">
          Dev build · dados de demonstração
        </div>
      </body>
    </html>
  );
}
