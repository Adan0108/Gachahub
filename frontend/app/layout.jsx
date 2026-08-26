import "./globals.css";
import { AppShell } from "../components/AppShell";
import { Providers } from "../components/Providers";

export const metadata = {
  title: "GachaHub",
  description: "Community hub for gacha game builds, lore, guides, and summaries.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
