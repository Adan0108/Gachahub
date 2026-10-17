import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Emoji pictures are served from our own origin, never a third-party CDN, so nobody outside sees who is reading a chat.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@twemoji", "svg");
const target = join(root, "public", "emoji", "svg");
const marker = join(target, ".version");

if (!existsSync(source)) {
  console.warn("emoji pictures: @twemoji/svg is not installed, skipping (emoji fall back to text)");
  process.exit(0);
}

const { version } = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
if (existsSync(marker) && readFileSync(marker, "utf8") === version) process.exit(0);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const file of readdirSync(source)) {
  if (file.endsWith(".svg")) cpSync(join(source, file), join(target, file));
}
writeFileSync(marker, version);
console.log(`emoji pictures: copied Twemoji ${version} to public/emoji/svg`);
