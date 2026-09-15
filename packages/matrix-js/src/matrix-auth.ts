import { MatrixError, createClient, type MatrixClient, AuthType } from "matrix-js-sdk";
import { SdkError } from "@relaykit/core";
import type { LoginCredentials, RegisterCredentials, Session } from "@relaykit/core";

const passwordOnlyStages = new Set([AuthType.Dummy as string]);

/** Registering and signing in end the same way: the homeserver's answer, read as a session. */
/** The parts of signing in and of registering that say the same thing, which is all this needs of either. */
interface WhatSigningInAnswers {
  readonly user_id: string;
  readonly access_token?: string;
  readonly device_id?: string;
  readonly refresh_token?: string;
  readonly expires_in_ms?: number;
}

/**
 * A session out of what the homeserver answered.
 *
 * The refresh token is asked for and kept when there is one: a homeserver that hands out short-lived tokens
 * expects to be asked for new ones, and a session without it is one that stops working and cannot be revived.
 */
function sessionFrom(homeserver: string, answer: WhatSigningInAnswers): Session {
  const expiresAt = answer.expires_in_ms ? Date.now() + answer.expires_in_ms : undefined;
  return {
    homeserver,
    userId: answer.user_id,
    accessToken: answer.access_token ?? "",
    ...(answer.device_id ? { deviceId: answer.device_id } : {}),
    ...(answer.refresh_token ? { refreshToken: answer.refresh_token } : {}),
    ...(expiresAt ? { expiresAt } : {})
  };
}

/**
 * What a homeserver is saying, when it is saying something an application can act on. Undefined for anything
 * else, because turning an error nobody understands into one that sounds understood hides it.
 *
 * Homeservers do not agree on *when* they say these. Synapse refuses a username that is taken on the first
 * word; Dendrite asks what it wants first and refuses on the second, once the conversation is finished. So
 * this is asked at every step rather than only at the beginning.
 */
export function whatTheHomeserverMeant(error: unknown): SdkError | undefined {
  if (!(error instanceof MatrixError)) return undefined;
  if (error.errcode === "M_USER_IN_USE") {
    return new SdkError("USERNAME_TAKEN", "That username is already taken");
  }
  if (error.errcode === "M_FORBIDDEN") {
    return new SdkError("REGISTRATION_UNSUPPORTED", "This homeserver does not allow creating accounts");
  }
  return undefined;
}

/**
 * Registration in Matrix is a conversation: the homeserver answers with the steps it wants. Only a homeserver
 * happy with a username and a password can be served here, and any other is told apart clearly instead of
 * failing with something unreadable.
 */
export async function registerWithPassword(credentials: RegisterCredentials): Promise<Session> {
  const client = createClient({ baseUrl: credentials.homeserver });
  try {
    const session = await startRegistration(client, credentials);
    // Asked again here: a homeserver that checks the username only once it has what it asked for says it is
    // taken at this point, and until this was here that came back as an unreadable adapter failure.
    const response = await client
      .registerRequest({
        username: credentials.username,
        password: credentials.password,
        auth: { type: AuthType.Dummy, session },
        refresh_token: true,
        ...(credentials.deviceName ? { initial_device_display_name: credentials.deviceName } : {})
      })
      .catch(error => {
        throw whatTheHomeserverMeant(error) ?? error;
      });
    if (!response.access_token) {
      throw new SdkError(
        "REGISTRATION_UNSUPPORTED",
        "The homeserver did not return a session for the new account"
      );
    }
    return sessionFrom(credentials.homeserver, response);
  } finally {
    client.stopClient();
  }
}

/** Asks the homeserver what it needs, and refuses early if it wants more than this can offer. */
async function startRegistration(client: MatrixClient, credentials: RegisterCredentials): Promise<string> {
  try {
    await client.registerRequest({ username: credentials.username, password: credentials.password });
  } catch (error) {
    if (!(error instanceof MatrixError)) throw error;
    // A homeserver that asks for steps answers 401 with them, and `M_FORBIDDEN` carries those flows too: what
    // is being refused matters only when there is nothing to try next, which is decided below.
    const said = whatTheHomeserverMeant(error);
    if (said && said.code === "USERNAME_TAKEN") throw said;
    const flows = (error.data as { flows?: { stages?: string[] }[]; session?: string }).flows ?? [];
    const session = (error.data as { session?: string }).session;
    const simplest = flows.find(flow => (flow.stages ?? []).every(stage => passwordOnlyStages.has(stage)));
    if (!simplest || !session) {
      const stages = [...new Set(flows.flatMap(flow => flow.stages ?? []))];
      throw new SdkError(
        "REGISTRATION_UNSUPPORTED",
        stages.length > 0
          ? `This homeserver requires: ${stages.join(", ")}`
          : "This homeserver does not allow creating accounts"
      );
    }
    return session;
  }
  throw new SdkError(
    "REGISTRATION_UNSUPPORTED",
    "The homeserver answered the registration in an unexpected way"
  );
}

export async function loginWithPassword(credentials: LoginCredentials): Promise<Session> {
  const client = createClient({ baseUrl: credentials.homeserver });
  const request = {
    user: credentials.username,
    password: credentials.password,
    // Asking for one: a homeserver that hands out short tokens only hands out the means to renew them to a
    // client that says it can. One that hands out long ones ignores this and answers without.
    refresh_token: true,
    ...(credentials.deviceName ? { initial_device_display_name: credentials.deviceName } : {})
  };

  try {
    const response = await client.login(AuthType.Password, request);
    return sessionFrom(credentials.homeserver, response);
  } finally {
    client.stopClient();
  }
}
