import { MatrixError, createClient, type MatrixClient } from "matrix-js-sdk";
import { SdkError } from "@relaykit/core";
import type { LoginCredentials, RegisterCredentials, Session } from "@relaykit/core";

const passwordOnlyStages = new Set(["m.login.dummy"]);

/**
 * Registration in Matrix is a conversation: the homeserver answers with the steps it wants. Only a homeserver
 * happy with a username and a password can be served here, and any other is told apart clearly instead of
 * failing with something unreadable.
 */
export async function registerWithPassword(credentials: RegisterCredentials): Promise<Session> {
  const client = createClient({ baseUrl: credentials.homeserver });
  try {
    const session = await startRegistration(client, credentials);
    const response = await client.registerRequest({
      username: credentials.username,
      password: credentials.password,
      auth: { type: "m.login.dummy", session },
      ...(credentials.deviceName ? { initial_device_display_name: credentials.deviceName } : {})
    });
    if (!response.access_token) {
      throw new SdkError("REGISTRATION_UNSUPPORTED", "The homeserver did not return a session for the new account");
    }
    return {
      homeserver: credentials.homeserver,
      userId: response.user_id,
      accessToken: response.access_token,
      ...(response.device_id ? { deviceId: response.device_id } : {})
    };
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
    if (error.errcode === "M_USER_IN_USE") {
      throw new SdkError("USERNAME_TAKEN", "That username is already taken");
    }
    if (error.errcode === "M_FORBIDDEN") {
      throw new SdkError("REGISTRATION_UNSUPPORTED", "This homeserver does not allow creating accounts");
    }
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
  throw new SdkError("REGISTRATION_UNSUPPORTED", "The homeserver answered the registration in an unexpected way");
}

export async function loginWithPassword(credentials: LoginCredentials): Promise<Session> {
  const client = createClient({ baseUrl: credentials.homeserver });
  const request = {
    user: credentials.username,
    password: credentials.password,
    ...(credentials.deviceName ? { initial_device_display_name: credentials.deviceName } : {})
  };

  try {
    const response = await client.login("m.login.password", request);
    return {
      homeserver: credentials.homeserver,
      userId: response.user_id,
      accessToken: response.access_token,
      ...(response.device_id ? { deviceId: response.device_id } : {})
    };
  } finally {
    client.stopClient();
  }
}

export async function logoutClient(client: MatrixClient): Promise<void> {
  await client.logout();
}
