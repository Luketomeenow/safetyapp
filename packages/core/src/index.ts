export type { AnswerInput, AnswerResult, Deps } from "./answer.ts";
export {
  answerOnce,
  answerQuestion,
  buildMessages,
  createDeps,
  DuplicateMessageError,
  sanitizeForReplay,
} from "./answer.ts";
export type { CoreConfig, Tracer, TraceSpan } from "./config.ts";
export { getConfig } from "./config.ts";
export type { Playbooks } from "./emergency.ts";
export { detectEmergency, loadPlaybooks, renderEmergencyText } from "./emergency.ts";
export { mapAnthropicError } from "./errors.ts";
export { keepAlive } from "./keepalive.ts";
export type { LoadedManual } from "./manual.ts";
export {
  loadActiveManual,
  ManualUnavailableError,
  programForPage,
  resolveSection,
} from "./manual.ts";
export { ConversationClosedError } from "./persist.ts";
export { buildRequestPrefix, stableStringify } from "./prompt/request-prefix.ts";
export { PROMPT_FINGERPRINT, PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt/system-prompt.ts";
export { extractQuotes, parseMarker, validateAnswer, verifyQuote } from "./validate.ts";
