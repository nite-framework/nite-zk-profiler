/**
 * Minimal ANSI styling.
 *
 * Deliberately not a dependency. A profiler that prints a table needs eight
 * escape codes, and a zero dependency CLI is easier to trust and audit than one
 * that pulls a package in to add colour.
 */

/**
 * Honours the NO_COLOR convention, FORCE_COLOR, and whether stdout is a
 * terminal, so piping to a file or a CI log produces clean text.
 */
function colorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  return process.stdout.isTTY === true;
}

let enabled = colorEnabled();

/** Test seam, and lets the CLI force plain output for `--json`. */
export function setColorEnabled(value: boolean): void {
  enabled = value;
}

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
} as const;

export type Style = keyof typeof CODES;

function wrap(text: string, ...styles: Style[]): string {
  if (!enabled || styles.length === 0) return text;
  const open = styles.map((s) => `[${CODES[s]}m`).join("");
  return `${open}${text}[${CODES.reset}m`;
}

export const bold = (t: string) => wrap(t, "bold");
export const dim = (t: string) => wrap(t, "dim");
export const red = (t: string) => wrap(t, "red");
export const green = (t: string) => wrap(t, "green");
export const yellow = (t: string) => wrap(t, "yellow");
export const cyan = (t: string) => wrap(t, "cyan");
export const gray = (t: string) => wrap(t, "gray");
export const boldRed = (t: string) => wrap(t, "bold", "red");
export const boldYellow = (t: string) => wrap(t, "bold", "yellow");

/**
 * Colour a circuit by how much it costs relative to the cheapest one here.
 * The thresholds are deliberately coarse: the point is to make the expensive
 * circuits findable at a glance, not to encode a precise scale.
 */
export function costColor(relativeCost: number): (t: string) => string {
  if (relativeCost >= 32) return boldRed;
  if (relativeCost >= 8) return red;
  if (relativeCost >= 2) return yellow;
  return green;
}

/** Width of a string once escape sequences are discounted. */
export function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, "").length;
}
