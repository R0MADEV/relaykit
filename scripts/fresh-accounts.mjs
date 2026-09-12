import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

/**
 * Accounts that exist for one run of one check and nothing else.
 *
 * Sharing alice, bob and carol between every check seemed thrifty and cost far more than it saved. A silence
 * left on a conversation by somebody clicking around the example broke a check about unread counts. Setting
 * recovery up resets the cross-signing identity, so running the recovery checks all day left the account
 * unable to verify anything, and the failure said nothing about any of that.
 *
 * A fresh account registers in about a second. What it buys is that a failing check means something is
 * broken, rather than meaning somebody has to go and find out what the account has been through.
 *
 * The environment fills up with throwaway accounts, which does not matter: `npm run matrix:up` builds the
 * whole thing again from nothing in fourteen seconds.
 */
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";

export async function registerAccount(purpose, deviceName, options = {}) {
  // Random rather than counted: two accounts made in the same millisecond must not collide, and a counter
  // would be state this module remembers between calls for no reason.
  const username = `${purpose}-${crypto.randomUUID().slice(0, 8)}`;
  const client = new MessagingClient({
    adapter: new MatrixJsAdapter(options.matrix ?? {}),
    storage: new InMemoryStorage()
  });
  const session = await client.register({
    homeserver,
    username,
    password: `${username}-password`,
    deviceName: deviceName ?? purpose
  });
  if (options.start !== false) await client.start();
  return {
    client,
    userId: session.userId,
    deviceId: session.deviceId,
    accessToken: session.accessToken,
    username,
    password: `${username}-password`
  };
}

/** Another device of somebody who already has an account, which is a different thing from another person. */
export async function signInAgain(account, deviceName, options = {}) {
  const client = new MessagingClient({
    adapter: new MatrixJsAdapter(options.matrix ?? {}),
    storage: new InMemoryStorage()
  });
  const session = await client.login({
    homeserver,
    username: account.username,
    password: account.password,
    deviceName
  });
  if (options.start !== false) await client.start();
  return {
    client,
    userId: session.userId,
    deviceId: session.deviceId,
    username: account.username,
    password: account.password
  };
}
