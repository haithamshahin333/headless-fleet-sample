import type { Metadata } from "next"
import { Geist, JetBrains_Mono } from "next/font/google"
import { connection } from "next/server"

import "./globals.css"
import { BrandProvider } from "@/components/brand"
import { ThemeProvider } from "@/components/theme-provider"
import { config } from "@/lib/config"

const fontSans = Geist({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })

// Read per request, not at build: one image serves any portal name.
export async function generateMetadata(): Promise<Metadata> {
  await connection()
  return {
    title: { default: config.portalName, template: `%s — ${config.portalName}` },
    description: "Every agent your team runs, in one place. Built on the LangSmith Headless Fleet API.",
    applicationName: config.portalName,
    // Tells the browser both themes are supported, so form controls and scrollbars
    // are painted to match rather than always light.
    other: { "color-scheme": "light dark" },
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection()
  return (
    <html lang="en" suppressHydrationWarning className={`${fontSans.variable} ${fontMono.variable}`}>
      <body>
        <ThemeProvider>
          <BrandProvider name={config.portalName}>
            {/* Visually hidden until focused. Without it a keyboard user tabs through
                the whole header before reaching the page's content. */}
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-foreground"
            >
              Skip to main content
            </a>
            {children}
          </BrandProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
