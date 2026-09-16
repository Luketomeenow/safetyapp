/** A 1-based (page, line) position inside the model text of the manual. */
export type Pos = { page: number; line: number };

/** One page of the manual as lines of model text. */
export type PageLines = { page_index: number; lines: string[] };

export function comparePos(a: Pos, b: Pos): number {
  return a.page - b.page || a.line - b.line;
}

export function lineAt(pages: PageLines[], pos: Pos): string {
  return pages[pos.page - 1]?.lines[pos.line - 1] ?? "";
}

/** The next position with content, crossing into later pages; null at the end of the document. */
export function nextPos(pages: PageLines[], pos: Pos): Pos | null {
  const page = pages[pos.page - 1];
  if (page && pos.line < page.lines.length) return { page: pos.page, line: pos.line + 1 };
  for (let p = pos.page + 1; p <= pages.length; p += 1) {
    if ((pages[p - 1]?.lines.length ?? 0) > 0) return { page: p, line: 1 };
  }
  return null;
}

/** The previous position, crossing into earlier pages; null before the start of the document. */
export function prevPos(pages: PageLines[], pos: Pos): Pos | null {
  if (pos.line > 1) return { page: pos.page, line: pos.line - 1 };
  for (let p = pos.page - 1; p >= 1; p -= 1) {
    const count = pages[p - 1]?.lines.length ?? 0;
    if (count > 0) return { page: p, line: count };
  }
  return null;
}

export function lastPos(pages: PageLines[]): Pos {
  for (let p = pages.length; p >= 1; p -= 1) {
    const count = pages[p - 1]?.lines.length ?? 0;
    if (count > 0) return { page: p, line: count };
  }
  return { page: 1, line: 1 };
}
