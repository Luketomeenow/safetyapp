import { createHmac } from "node:crypto";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import * as Sentry from "@sentry/node";

/**
 * Observability wiring. Langfuse tracing starts only when its keys are present; Sentry only with a
 * DSN. Both are no-ops otherwise, so local development and tests need no accounts.
 */
let processor: LangfuseSpanProcessor | null = null;
let sdk: NodeSDK | null = null;

export function startTelemetry(): void {
  if (sdk) return;
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    processor = new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://us.cloud.langfuse.com",
      environment: process.env.APP_ENV ?? "development",
    });
    sdk = new NodeSDK({ spanProcessors: [processor] });
    sdk.start();
  }
  if (process.env.SENTRY_DSN && !Sentry.isInitialized()) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.APP_ENV ?? "development",
      release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
      sendDefaultPii: false,
      // Never ship question or answer text to Sentry.
      beforeSend(event) {
        if (event.request) event.request.data = undefined;
        return event;
      },
    });
  }
}

export const telemetryEnabled = (): boolean => processor !== null;

/** Serverless functions must flush before the invocation ends. */
export async function flushTelemetry(): Promise<void> {
  await Promise.all([
    processor?.forceFlush(),
    Sentry.isInitialized() ? Sentry.flush(2000) : Promise.resolve(),
  ]);
}

export function captureError(
  error: unknown,
  context: Record<string, string | number | boolean | null | undefined>,
): void {
  console.error("api error", context, error);
  if (Sentry.isInitialized())
    Sentry.captureException(error, { tags: context as Record<string, string> });
}

/** Stable pseudonymous id for tracing: HMAC of the identity subject, never the subject itself. */
export function pseudonymousUserId(issuer: string, subject: string): string {
  const secret = process.env.USER_ID_HMAC_SECRET ?? "dev";
  return createHmac("sha256", secret).update(`${issuer}|${subject}`).digest("hex").slice(0, 24);
}
