// Constraint 1, enforced mechanically rather than by review.
//
// The software applies filters to a directory. It does not recommend, diagnose, triage or
// assess, and it never calls anything the "best". Those words are banned from identifiers,
// string literals and comments across every package, because the vocabulary is how this kind of
// product drifts: one `recommendSurgeon` in a helper, and six months later the UI says
// "recommended for you" and the thing is a medical device.
//
// A line that genuinely needs a banned word — this file, and any deliberate quotation of the
// rule — carries `lint-allow-language` and a reason, either on the line itself or on the line
// immediately above it. Above is usually right: an exemption that needs explaining needs more
// room than the end of the line it is exempting.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const BANNED = ["recommend", "diagnose", "triage", "assess", "best"] as const;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "__golden__", ".vite"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html"]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (EXTENSIONS.has(extname(full))) found.push(full);
  }
  return found;
}

describe("the language rule", () => {
  const files = [join(ROOT, "packages"), join(ROOT, "tools")].flatMap((d) => sourceFiles(d));

  it("finds source to check — a silent zero would pass forever", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no banned word appears anywhere in the tree", () => {
    const offences: string[] = [];
    for (const file of files) {
      if (file === fileURLToPath(import.meta.url)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const exempt =
          line.includes("lint-allow-language") ||
          (lines[index - 1]?.includes("lint-allow-language") ?? false);
        if (exempt) return;
        for (const word of BANNED) {
          if (new RegExp(`\\b${word}`, "i").test(line)) {
            offences.push(`${relative(ROOT, file)}:${index + 1}  ${word}  ${line.trim().slice(0, 90)}`);
          }
        }
      });
    }
    expect(offences.join("\n")).toBe("");
  });
});
