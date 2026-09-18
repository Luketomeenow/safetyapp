import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type EvalCase,
  EvalCaseSchema,
  type SetName,
  type Thresholds,
  ThresholdsSchema,
} from "./schema.ts";

export const DATA_DIR = path.join(import.meta.dirname, "..", "data");

export function readJsonl(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l) as unknown;
      } catch (e) {
        throw new Error(`${file}:${i + 1}: invalid JSON (${(e as Error).message})`);
      }
    });
}

export type LoadedCases = { cases: EvalCase[]; problems: string[]; needs_reauthoring: string[] };

/** Loads every set plus inbox drafts, validates, de-duplicates ids, and applies corpus flips. */
export function loadCases(includedDocs: string[], opts: { includeDrafts: boolean }): LoadedCases {
  const problems: string[] = [];
  const cases: EvalCase[] = [];
  const files = [
    ...["golden", "negative", "adversarial", "emergency"].map((s) =>
      path.join(DATA_DIR, `${s}.jsonl`),
    ),
    ...(existsSync(path.join(DATA_DIR, "inbox"))
      ? readdirSync(path.join(DATA_DIR, "inbox"))
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => path.join(DATA_DIR, "inbox", f))
      : []),
  ];
  const seen = new Set<string>();
  for (const file of files) {
    for (const raw of readJsonl(file)) {
      const parsed = EvalCaseSchema.safeParse(raw);
      if (!parsed.success) {
        problems.push(
          `${path.basename(file)}: ${(raw as { id?: string }).id ?? "?"}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        );
        continue;
      }
      const c = parsed.data;
      if (seen.has(c.id)) problems.push(`duplicate id ${c.id}`);
      seen.add(c.id);
      if (c.source.status === "retired") continue;
      if (c.source.status === "draft" && !opts.includeDrafts) continue;
      cases.push(c);
    }
  }
  const needs_reauthoring: string[] = [];
  const kept = cases.filter((c) => {
    if (
      c.corpus &&
      c.expected.behavior === "not_covered" &&
      c.corpus.requires_docs.every((d) => includedDocs.includes(d))
    ) {
      needs_reauthoring.push(c.id);
      return false;
    }
    return true;
  });
  return { cases: kept, problems, needs_reauthoring };
}

export function loadThresholds(): Thresholds {
  return ThresholdsSchema.parse(
    JSON.parse(readFileSync(path.join(DATA_DIR, "thresholds.json"), "utf8")),
  );
}

/** Deterministic PRNG so a sample is reproducible from its seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stratified sample: at least one golden case per non-negotiable program, then spread across programs. */
export function sampleCases(
  cases: EvalCase[],
  sizes: Record<SetName, number | null>,
  seed: number,
): EvalCase[] {
  const rand = mulberry32(seed);
  const shuffle = <T>(arr: T[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j] as T, a[i] as T];
    }
    return a;
  };
  const out: EvalCase[] = [];
  for (const set of ["golden", "negative", "adversarial", "emergency"] as SetName[]) {
    const pool = shuffle(cases.filter((c) => c.set === set));
    const n = sizes[set];
    if (n === null || n >= pool.length) {
      out.push(...pool);
      continue;
    }
    if (set === "golden") {
      const picked: EvalCase[] = [];
      for (const program of [8, 9, 12, 19, 20]) {
        const c = pool.find((x) => x.tags.program === program && !picked.includes(x));
        if (c) picked.push(c);
      }
      const byProgram = new Map<number, EvalCase[]>();
      for (const c of pool)
        if (!picked.includes(c))
          byProgram.set(c.tags.program ?? 0, [...(byProgram.get(c.tags.program ?? 0) ?? []), c]);
      const programs = shuffle([...byProgram.keys()]);
      let i = 0;
      while (picked.length < n && byProgram.size > 0) {
        const p = programs[i % programs.length] as number;
        const list = byProgram.get(p);
        if (list && list.length > 0) picked.push(list.shift() as EvalCase);
        if (list && list.length === 0) byProgram.delete(p);
        i += 1;
        if (i > 10_000) break;
      }
      out.push(...picked.slice(0, n));
    } else {
      out.push(...pool.slice(0, n));
    }
  }
  return out;
}
