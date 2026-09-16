/**
 * Text normalization shared by ingestion (building blocks, matching headings),
 * the answer pipeline (verifying quotes) and the eval harness.
 */

const ZERO_WIDTH_RE = /​|‌|‍|⁠|﻿/g;

/**
 * The text the model sees for a page: zero-width characters removed, line endings normalized,
 * trailing spaces trimmed and runs of blank lines collapsed. Everything else, including curly
 * quotes and the manual's own typos, is preserved so quoted policy text still matches the PDF.
 */
export function toModelText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(ZERO_WIDTH_RE, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Aggressive normalization used only for comparisons (quotes against page text, headings against
 * the table of contents): NFKC, zero-width characters removed, curly quotes and dashes folded to
 * ASCII, whitespace collapsed, lowercase.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

const LEADING_MARKER_RE = /^(?:[•●○▪■‣◦\-*]+\s*)+/;
const LEADING_NUMBER_RE = /^\d+(?:\.\d+)*[.)]?\s+/;

/** Heading comparison: normalizeForMatch plus leading bullets or list numbers and trailing punctuation removed. */
export function normalizeHeading(text: string): string {
  return normalizeForMatch(text)
    .replace(LEADING_MARKER_RE, "")
    .replace(LEADING_NUMBER_RE, "")
    .replace(/[\s.:;,]+$/, "")
    .trim();
}

export function tokenSet(text: string): Set<string> {
  return new Set(text.split(/[^a-z0-9]+/).filter((t) => t.length > 0));
}

/** Token-set Dice coefficient in [0, 1]; inputs should already be normalized. */
export function diceCoefficient(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return (2 * shared) / (setA.size + setB.size);
}

export function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}
