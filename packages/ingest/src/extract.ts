import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type RawPage = { page_index: number; raw_text: string };
export type ExtractResult = {
  pages: RawPage[];
  pdfinfo_pages: number;
  producer: string | null;
  pdftotext_version: string;
};

/** `pdftotext -v` prints its version on stderr and exits non-zero on some builds. */
export async function pdftotextVersion(): Promise<string> {
  try {
    const { stdout, stderr } = await run("pdftotext", ["-v"]);
    return parseVersion(`${stdout}\n${stderr}`);
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return parseVersion(`${e.stdout ?? ""}\n${e.stderr ?? ""}`);
  }
}

function parseVersion(text: string): string {
  const m = /pdftotext version (\S+)/.exec(text);
  return m?.[1] ?? "unknown";
}

/** Runs pdfinfo and pdftotext (raw reading order, UTF-8, unix line endings) and splits pages on form feeds. */
export async function extractPages(pdfPath: string): Promise<ExtractResult> {
  const { stdout: info } = await run("pdfinfo", [pdfPath]);
  const pagesMatch = /^Pages:\s+(\d+)/m.exec(info);
  if (!pagesMatch?.[1]) throw new Error(`pdfinfo did not report a page count for ${pdfPath}`);
  const pdfinfoPages = Number(pagesMatch[1]);
  const producer = /^Producer:\s+(.+)$/m.exec(info)?.[1]?.trim() ?? null;

  const { stdout } = await run("pdftotext", ["-enc", "UTF-8", "-eol", "unix", pdfPath, "-"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const parts = stdout.split("\f");
  // pdftotext writes a form feed after every page, so the final element is an empty string.
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  if (parts.length !== pdfinfoPages) {
    throw new Error(`pdftotext produced ${parts.length} pages but pdfinfo reports ${pdfinfoPages}`);
  }
  return {
    pages: parts.map((raw_text, i) => ({ page_index: i + 1, raw_text })),
    pdfinfo_pages: pdfinfoPages,
    producer,
    pdftotext_version: await pdftotextVersion(),
  };
}
