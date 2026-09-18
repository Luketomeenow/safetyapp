import Anthropic from "@anthropic-ai/sdk";
import type { ErrorCode } from "@axxiom/shared";

export type MappedError = { code: ErrorCode; message: string; retryable: boolean; alert: boolean };

/** Most specific first; APIConnectionError before APIError (it is a subclass in the TypeScript SDK). */
export function mapAnthropicError(error: unknown): MappedError {
  const manualMessage = "The assistant is unavailable right now. Use the manual in the app.";
  if (error instanceof Anthropic.RateLimitError) {
    return {
      code: "rate_limited",
      message: "Too many questions right now. Try again in a minute.",
      retryable: true,
      alert: false,
    };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return { code: "upstream_unavailable", message: manualMessage, retryable: true, alert: false };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { code: "upstream_unavailable", message: manualMessage, retryable: true, alert: false };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { code: "internal", message: manualMessage, retryable: false, alert: true };
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError
  ) {
    return { code: "internal", message: manualMessage, retryable: false, alert: true };
  }
  if (error instanceof Anthropic.APIError) {
    return { code: "upstream_unavailable", message: manualMessage, retryable: true, alert: true };
  }
  return { code: "internal", message: manualMessage, retryable: false, alert: true };
}

export function mentionsBetaHeader(error: unknown): boolean {
  return error instanceof Anthropic.BadRequestError && /beta|fallbacks/i.test(error.message);
}
