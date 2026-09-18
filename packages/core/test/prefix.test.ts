import { describe, expect, it } from "vitest";
import { buildMessages, sanitizeForReplay } from "../src/answer.ts";
import { buildRequestPrefix, stableStringify } from "../src/prompt/request-prefix.ts";
import { fixtureManual } from "./fixtures.ts";

describe("buildRequestPrefix", () => {
  it("is byte-deterministic and puts the single cache breakpoint on the manual document", () => {
    const a = buildRequestPrefix(fixtureManual());
    const b = buildRequestPrefix(fixtureManual());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.manualDocument.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(a.manualDocument.citations).toEqual({ enabled: true });
    expect(a.manualDocument.source.content).toHaveLength(3);
    expect(a.manualDocument.source.content[1]?.text.startsWith("[Page 2 of 3 |")).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps
  });
  it("stableStringify sorts keys", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});

describe("buildMessages", () => {
  const prefix = buildRequestPrefix(fixtureManual());
  it("rebuilds turn one as [manual document, first question] and appends the new question", () => {
    const history = [
      { role: "user" as const, content: [{ type: "text", text: "first?" }] },
      { role: "assistant" as const, content: [{ type: "text", text: "[[AXX:ANSWER]]\nyes" }] },
    ];
    const messages = buildMessages(prefix, history, "second?");
    expect(messages).toHaveLength(3);
    expect(messages[0]?.content[0]).toBe(prefix.manualDocument);
    expect(messages[0]?.content[1]).toEqual({ type: "text", text: "first?" });
    expect(messages[2]).toEqual({ role: "user", content: [{ type: "text", text: "second?" }] });
  });
  it("first turn carries the manual and the new question only", () => {
    const messages = buildMessages(prefix, [], "hello?");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toHaveLength(2);
  });
});

describe("sanitizeForReplay", () => {
  it("drops thinking before the last fallback block and the fallback marker itself", () => {
    const content = [
      { type: "thinking", thinking: "" },
      { type: "text", text: "partial" },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "thinking", thinking: "" },
      { type: "text", text: "rest" },
    ];
    expect(sanitizeForReplay(content).map((b) => (b as { type: string }).type)).toEqual([
      "text",
      "thinking",
      "text",
    ]);
  });
});
