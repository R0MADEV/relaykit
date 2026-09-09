import { createClient, type MatrixClient } from "matrix-js-sdk";
import type { LoginCredentials, Session } from "@relaykit/core";

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
