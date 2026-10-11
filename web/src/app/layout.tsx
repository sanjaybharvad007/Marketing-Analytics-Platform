import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { THEME_INIT_SCRIPT, type Theme } from "@/components/shell/theme-toggle";
import { Topbar } from "@/components/shell/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { env } from "@/lib/env";
import { getDataAnchor, getWorkspaceStatus } from "@/lib/services/meta";
import "./globals.css";

// Instrument Sans (SIL Open Font License) with its weight and width axes.
const instrumentSans = localFont({
  src: "../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wdth-normal.woff2",
  variable: "--font-instrument",
  weight: "400 700",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "75% 100%" }],
});

export const metadata: Metadata = {
  title: { default: "MAP", template: "%s | MAP" },
  description: "Reporting, page planning and work management for the marketing team.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get("theme")?.value;
  const theme: Theme | null =
    cookieTheme === "dark" || cookieTheme === "light" ? cookieTheme : null;
  const { BRAND_NAME, SITE_URL } = env();
  const [status, anchor] = await Promise.all([getWorkspaceStatus(), getDataAnchor()]);

  return (
    <html
      lang="en"
      data-theme={theme ?? undefined}
      className={instrumentSans.variable}
      suppressHydrationWarning
    >
      <head>
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <ToastProvider>
          <Sidebar workspace={BRAND_NAME} />
          <div className="min-h-screen pl-14 lg:pl-[216px]">
            <Topbar
              workspace={BRAND_NAME}
              siteUrl={SITE_URL}
              status={status}
              dataThrough={anchor}
              theme={theme}
            />
            <main id="main" className="mx-auto max-w-[1440px] px-4 pt-5 pb-12 md:px-6">
              {children}
            </main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
