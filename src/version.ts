import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read from package.json rather than hardcoded, because `npm version` updates
 * the manifest and would silently leave a literal behind, so `--version` would
 * report the wrong release.
 *
 * Resolves from this module, which sits one level below the manifest in both
 * `src/` and the published `dist/`.
 */
export function toolVersion(): string {
  try {
    const manifest = join(import.meta.dirname, "..", "package.json");
    return JSON.parse(readFileSync(manifest, "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
