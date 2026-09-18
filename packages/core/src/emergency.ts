import { readFileSync } from "node:fs";
import { normalizeForMatch } from "@axxiom/shared";

export type PlaybookStep = {
  text: string;
  source: "manual" | "proposed";
  page?: number;
  section?: string;
  quote?: string;
  note?: string;
};
export type Playbook = { id: string; headline: string; triggers: string[]; steps: PlaybookStep[] };
export type Playbooks = {
  status: string;
  call: { label: string; tel: string };
  contacts: { label: string; tel: string; note?: string }[];
  default: { headline: string; steps: PlaybookStep[] };
  playbooks: Playbook[];
};

export function loadPlaybooks(file: string): Playbooks {
  return JSON.parse(readFileSync(file, "utf8")) as Playbooks;
}

/** Present-tense or first-person cue: something is happening now, not a policy question. */
const CUE_RE =
  /\b(is|are|am|was|just|right now|now|help|there's|there is|he's|she's|they're|my|our|someone|somebody|a guy|coworker|co-worker|helper)\b/i;
const HAZARD_RE =
  /\b(unconscious|not breathing|isn't breathing|bleeding|trapped|stuck in the (pit|hoistway|car)|fell|fallen|fall(ing)? from|shock(ed)?|electrocut\w*|fire|smoke|chemical (in|on) (my|his|her|their)|burn(ed|ing|s)?|chest pain|heart attack|seizure|passed out|collapsed|911|crushed|pinned|caught between|heat stroke|stopped sweating|can't breathe|cannot breathe|hurt bad|badly hurt|injured)\b/i;
/** Policy-style phrasing that should go to the model instead. */
const POLICY_RE =
  /\b(what is the procedure|what should i do if|policy|procedure for|requirements? for|how do i report|what does the manual|in case of|training|signs of|symptoms of|what are the|what is|when (do|should|can|must)|how (do|should|can) i|can i|am i allowed|do i need)\b/i;
/** Interrogative openers signal a question about policy unless urgency words are present. */
const QUESTION_OPENER_RE =
  /^(what|when|where|how|which|why|can|could|should|do|does|is it|are there|am i|if )/i;
const URGENCY_RE = /\b911\b|right now|\bnow\b|\bjust\b|\bhelp\b/i;

export type EmergencyMatch = { playbook: Playbook | null; headline: string; steps: PlaybookStep[] };

/**
 * Deterministic pre-check run before any model call. A hit returns the matching playbook (or the
 * default steps) and short-circuits the turn. Under-triggering is preferred: the model can still
 * answer with the EMERGENCY marker.
 */
export function detectEmergency(message: string, playbooks: Playbooks): EmergencyMatch | null {
  const text = message.trim();
  if (text.length === 0 || text.length > 1200) return null;
  const urgent = URGENCY_RE.test(text);
  if (POLICY_RE.test(text) && !urgent) return null;
  if (QUESTION_OPENER_RE.test(text) && !urgent) return null;
  if (!HAZARD_RE.test(text) || !CUE_RE.test(text)) return null;
  const n = normalizeForMatch(text);
  let best: { playbook: Playbook; score: number } | null = null;
  for (const pb of playbooks.playbooks) {
    const matched = pb.triggers.map(normalizeForMatch).filter((t) => n.includes(t));
    const score = matched.reduce((sum, t) => sum + t.length, 0);
    if (score > 0 && (!best || score > best.score)) best = { playbook: pb, score };
  }
  if (best)
    return {
      playbook: best.playbook,
      headline: best.playbook.headline,
      steps: best.playbook.steps,
    };
  return { playbook: null, headline: playbooks.default.headline, steps: playbooks.default.steps };
}

export function renderEmergencyText(match: EmergencyMatch, playbooks: Playbooks): string {
  const lines = [
    `**${match.headline}**`,
    "",
    `${playbooks.call.label} (${playbooks.call.tel}).`,
    "",
  ];
  for (const s of match.steps) {
    const ref = s.page ? ` (${s.section ? `${s.section}, ` : ""}page ${s.page})` : "";
    lines.push(`- ${s.text}${ref}`);
  }
  return lines.join("\n");
}
