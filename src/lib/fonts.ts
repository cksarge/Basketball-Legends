/** Canvas/SVG-safe display font stack (next/font registers a generated family name). */
export function displayFont(): string {
  if (typeof document === "undefined") return "'Arial Narrow', Impact, sans-serif";
  const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-big-shoulders").trim();
  return `${fam ? fam + ", " : ""}'Arial Narrow', Impact, sans-serif`;
}

/** Resolve once web fonts are ready (canvas text drawn before this falls back). */
export function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  return document.fonts.ready.then(() => undefined);
}
