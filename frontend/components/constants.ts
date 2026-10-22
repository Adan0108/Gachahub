import type { IconType } from "react-icons";
export interface BuildSummary {
  name: string;
  role: string;
  tone: string;
  likes: string;
  views: string;
  icon?: string;
}
export interface NavigationItem {
  href: string;
  icon: IconType;
  label: string;
  exact?: boolean;
  match?: string;
}
export type StudioTool =
  "Template" | "Background" | "Particles" | "Effects" | "Text" | "Frame" | "Decorations";
import {
  FiBookOpen,
  FiBox,
  FiCompass,
  FiEdit3,
  FiGrid,
  FiHome,
  FiImage,
  FiLayers,
  FiMessageCircle,
  FiShield,
  FiStar,
  FiTool,
  FiUsers,
} from "react-icons/fi";

export const glyph = {
  sparkle: "\u2726",
  star: "\u2605",
  diamond: "\u25c7",
  moon: "\u263e",
  sword: "\u2694",
  snow: "\u2744",
  dot: "\u25c9",
  check: "\u2713",
};

export const artTones = ["violet", "blue", "amber", "rose", "cyan", "indigo"];

export const builds: BuildSummary[] = [
  {
    name: "Sanhua",
    role: "Main DPS",
    tone: "violet",
    likes: "97%",
    views: "2.3K",
    icon: glyph.snow,
  },
  {
    name: "Jiyan",
    role: "Hypercarry",
    tone: "cyan",
    likes: "95%",
    views: "1.8K",
    icon: glyph.sword,
  },
  {
    name: "Changli",
    role: "Fusion Burst",
    tone: "rose",
    likes: "93%",
    views: "1.6K",
    icon: glyph.sparkle,
  },
  {
    name: "Calcharo",
    role: "Lightning DPS",
    tone: "indigo",
    likes: "94%",
    views: "1.2K",
    icon: "\u03df",
  },
];

export const navItems: NavigationItem[] = [
  { href: "/", icon: FiHome, label: "Home", exact: true },
  { href: "/community/wuthering-waves", icon: FiUsers, label: "Communities", match: "/community" },
  { href: "/explore", icon: FiCompass, label: "Explore" },
  { href: "/chat", icon: FiMessageCircle, label: "Messages" },
  { href: "/summaries", icon: FiLayers, label: "AI Summaries" },
  { href: "/studio", icon: FiTool, label: "Build Studio" },
  { href: "/lore", icon: FiBookOpen, label: "Lore Library" },
];

export const toolItems: [IconType, StudioTool][] = [
  [FiGrid, "Template"],
  [FiImage, "Background"],
  [FiStar, "Particles"],
  [FiLayers, "Effects"],
  [FiEdit3, "Text"],
  [FiBox, "Frame"],
  [FiShield, "Decorations"],
];
