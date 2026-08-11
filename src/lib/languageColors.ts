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
