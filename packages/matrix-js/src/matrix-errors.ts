import { MatrixError } from "matrix-js-sdk";
import { SdkError } from "@relaykit/core";

const invalidSessionCodes = new Set(["M_UNKNOWN_TOKEN", "M_MISSING_TOKEN"]);

/**
 * Turns the Matrix errors an application should react to into SdkError, so homeserver details never
 * reach the public API. Anything else is passed through untouched.
 */
export function translateMatrixError(error: unknown): unknown {
  if (!(error instanceof MatrixError)) {
    return error;
  }
  const { httpStatus, errcode, data } = error;
  const isRateLimited = httpStatus === 429 || errcode === "M_LIMIT_EXCEEDED";
  if (isRateLimited) {
    const retryAfter = (data as { retry_after_ms?: unknown }).retry_after_ms;
    const retryAfterMs = typeof retryAfter === "number" ? retryAfter : undefined;
    return new SdkError("RATE_LIMITED", "The homeserver is rate limiting this client", retryAfterMs);
  }
  if (errcode !== undefined && invalidSessionCodes.has(errcode)) {
    return new SdkError("INVALID_SESSION", "The session is no longer valid, log in again");
  }
  return error;
}

/** Runs an adapter operation, translating homeserver errors on the way out. */
export async function withTranslatedErrors<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw translateMatrixError(error);
  }
}
