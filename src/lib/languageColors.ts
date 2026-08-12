/**
 * GitHub's own language colours. Borrowed deliberately: the shelf should be
 * coloured in the vocabulary the user already reads GitHub in.
 */
const COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Elixir: "#6e4a7e",
  Scala: "#c22d40",
  Haskell: "#5e5086",
  Lua: "#000080",
  Dart: "#00B4AB",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Zig: "#ec915c",
  Julia: "#a270ba",
  Clojure: "#db5855",
  OCaml: "#3be133",
  Nix: "#7e7eff",
  R: "#198CE7",
  Jupyter: "#DA5B0B",
  "Jupyter Notebook": "#DA5B0B",
  Makefile: "#427819",
  Dockerfile: "#384d54",
  Vim: "#199f4b",
  "Emacs Lisp": "#c065db",
};

const UNKNOWN = "#8f9a95";

export function languageColor(language: string | null): string {
  if (!language) return UNKNOWN;
  return COLORS[language] ?? UNKNOWN;
}

const DARK_INK = "#14181a";
const LIGHT_INK = "#f0f2ef";

/** WCAG relative luminance. Gamma matters: mid tones are darker than they look. */
function luminance(hex: string): number | null {
  const digits = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(digits)) return null;

  const [r, g, b] = [0, 2, 4]
    .map((offset) => parseInt(digits.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

/**
 * Ink that stays readable on a given background.
 *
 * The palette is GitHub's, which runs from #f1e05a to #000080, so one fixed
 * text colour is illegible at one end or the other. Rather than pick a
 * brightness threshold and then argue about where it sits — Go's cyan lands
 * exactly on any plausible one — this measures both candidates and takes the
 * one with more contrast.
 */
export function readableInk(background: string): string {
  const target = luminance(background);
  if (target === null) return DARK_INK;

  const dark = luminance(DARK_INK) ?? 0;
  const light = luminance(LIGHT_INK) ?? 1;
  return contrast(target, dark) >= contrast(target, light) ? DARK_INK : LIGHT_INK;
}
