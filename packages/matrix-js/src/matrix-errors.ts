import { ConnectionError, MatrixError } from "matrix-js-sdk";
import { RelayKitError, type RelayKitErrorCode } from "@relaykit/core";

/**
 * What a homeserver's refusal means, said in this library's words.
 *
 * A code is here because an application would do something different about it, not because Matrix has a name
 * for it. The rest fall through to `ADAPTER_ERROR`, which says only "the backend refused" — and whatever the
 * homeserver wrote goes into `detail`, for a log, never into the message somebody might read or branch on.
 */
const whatItMeans = new Map<string, RelayKitErrorCode>([
  ["M_UNKNOWN_TOKEN", "INVALID_SESSION"],
  ["M_MISSING_TOKEN", "INVALID_SESSION"],
  ["M_FORBIDDEN", "FORBIDDEN"],
  ["M_GUEST_ACCESS_FORBIDDEN", "FORBIDDEN"],
  ["M_BAD_STATE", "FORBIDDEN"],
  ["M_NOT_FOUND", "CONVERSATION_NOT_FOUND"],
  ["M_USER_IN_USE", "USERNAME_TAKEN"],
  ["M_INVALID_USERNAME", "INVALID_INPUT"],
  ["M_MISSING_PARAM", "INVALID_INPUT"],
  ["M_INVALID_PARAM", "INVALID_INPUT"],
  ["M_TOO_LARGE", "INVALID_INPUT"],
  ["M_UNRECOGNIZED", "NOT_SUPPORTED"],
  ["M_UNAUTHORIZED", "FORBIDDEN"],
  ["M_THREEPID_AUTH_FAILED", "FORBIDDEN"],
  ["M_THREEPID_IN_USE", "INVALID_INPUT"],
  ["M_WEAK_PASSWORD", "INVALID_INPUT"],
  ["M_EXCLUSIVE", "FORBIDDEN"]
]);

/** What this library says for each of them. The homeserver's own wording never reaches here. */
const inTheseWords: Record<RelayKitErrorCode, string> = {
  NOT_STARTED: "The client has not been started",
  ALREADY_STARTED: "The client is already started",
  NOT_CONFIGURED: "The client is not configured for that",
  INVALID_SESSION: "The session is no longer valid, sign in again",
  INVALID_INPUT: "The server would not accept that",
  MESSAGE_NOT_FOUND: "There is no such message",
  CONVERSATION_NOT_FOUND: "There is no such conversation",
  VERIFICATION_NOT_FOUND: "There is no such verification",
  FORBIDDEN: "This account is not allowed to do that",
  NOT_SUPPORTED: "This homeserver does not do that",
  RATE_LIMITED: "The homeserver is asking this client to slow down",
  USERNAME_TAKEN: "That username is already taken",
  REGISTRATION_UNSUPPORTED: "This homeserver does not allow creating accounts",
  NETWORK_ERROR: "The homeserver could not be reached",
  ADAPTER_ERROR: "The homeserver refused the request"
};

/**
 * Turns whatever went wrong underneath into the one kind of error this library throws.
 *
 * Nothing from matrix-js-sdk is ever handed on: not its types, not its codes, and not its wording. An
 * application that has to read an English sentence a homeserver happened to write is an application coupled
 * to that homeserver, which is the whole thing this library exists to prevent.
 */
export function translateMatrixError(error: unknown): RelayKitError {
  if (error instanceof RelayKitError) return error;

  // The homeserver was never reached. Worth trying again, and nothing is known about whether it happened.
  if (error instanceof ConnectionError) {
    return new RelayKitError("NETWORK_ERROR", inTheseWords.NETWORK_ERROR, { detail: error.message });
  }

  if (error instanceof MatrixError) {
    const { httpStatus, errcode, data } = error;
    const isRateLimited = httpStatus === 429 || errcode === "M_LIMIT_EXCEEDED";
    if (isRateLimited) {
      const asked = readsAs(data, "retry_after_ms");
      return new RelayKitError("RATE_LIMITED", inTheseWords.RATE_LIMITED, {
        ...(typeof asked === "number" ? { retryAfterMs: asked } : {}),
        ...detailOf(error)
      });
    }
    // Falling back on the status when the homeserver gave no code of its own, which some of them do.
    const code = (errcode !== undefined ? whatItMeans.get(errcode) : undefined) ?? byStatus(httpStatus);
    return new RelayKitError(code, inTheseWords[code], detailOf(error));
  }

  // Something that is not the homeserver at all: a bug here, or the browser refusing. Said as little as
  // possible, and what it actually was kept for the log.
  const said = error instanceof Error ? error.message : String(error);
  return new RelayKitError("ADAPTER_ERROR", inTheseWords.ADAPTER_ERROR, { detail: said });
}

/** What an HTTP status means on its own, for a homeserver that answered without saying anything else. */
function byStatus(status: number | undefined): RelayKitErrorCode {
  if (status === 401) return "INVALID_SESSION";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "CONVERSATION_NOT_FOUND";
  if (status === 400) return "INVALID_INPUT";
  if (status !== undefined && status >= 500) return "ADAPTER_ERROR";
  return "ADAPTER_ERROR";
}

/**
 * What the homeserver wrote, kept where a log can find it.
 *
 * Its own code goes in too: it is the thing worth putting in a bug report, and the thing that says whether a
 * new entry belongs in the map above.
 */
function detailOf(error: MatrixError): { detail: string } {
  const said = readsAs(error.data, "error");
  const wrote = typeof said === "string" ? said : error.message;
  return { detail: error.errcode ? `${error.errcode}: ${wrote}` : wrote };
}

/** Reading one field off something the homeserver sent, without pretending to know its shape. */
function readsAs(from: unknown, name: string): unknown {
  if (typeof from !== "object" || from === null) return undefined;
  return Object.getOwnPropertyDescriptor(from, name)?.value;
}

/** Runs an adapter operation, turning whatever comes out of it into this library's one kind of error. */
export async function withTranslatedErrors<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw translateMatrixError(error);
  }
}
