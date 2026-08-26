import "./globals.css";
import { AppShell } from "../components/AppShell";
import { Providers } from "../components/Providers";

export const metadata = {
  title: "GachaHub",
  description: "Community hub for gacha game builds, lore, guides, and summaries.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const key = "gachahub-theme";
                const saved = localStorage.getItem(key);
                const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
                const theme = saved === "light" || saved === "dark" ? saved : system;
                document.documentElement.dataset.theme = theme;
              } catch {}
            `,
          }}
        />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
