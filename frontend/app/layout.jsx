import "./globals.css";
import { cookies } from "next/headers";
import { AppShell } from "../components/AppShell";
import { Providers } from "../components/Providers";

const THEME_STORAGE_KEY = "gachahub-theme";

export const metadata = {
  title: "GachaHub",
  description: "Community hub for gacha game builds, lore, guides, and summaries.",
};

export default async function RootLayout({ children }) {
  const themeCookie = (await cookies()).get(THEME_STORAGE_KEY)?.value;
  const initialTheme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : "dark";

  return (
    <html lang="en" data-theme={initialTheme} suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const key = "gachahub-theme";
                const saved = localStorage.getItem(key);
                const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
                const serverTheme = document.documentElement.dataset.theme;
                const fallback = serverTheme === "light" || serverTheme === "dark" ? serverTheme : system;
                const theme = saved === "light" || saved === "dark" ? saved : fallback;
                document.documentElement.dataset.theme = theme;
              } catch {}
            `,
          }}
        />
        <Providers>
          <AppShell initialTheme={initialTheme}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
