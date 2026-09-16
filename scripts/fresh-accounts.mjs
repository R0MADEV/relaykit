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
 * They close themselves when the run is over — `closeThem(...)` at the end of a check. It turned out to
 * matter: the homeserver's people directory is the same directory the example searches, so seven hundred
 * accounts nobody uses is what somebody typing a name into the invite box actually sees.
 */
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";

/** What this run registered, so a check with nowhere tidy to put the closing can still close them. */
const madeHere = [];

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
  const account = {
    client,
    userId: session.userId,
    deviceId: session.deviceId,
    accessToken: session.accessToken,
    username,
    password: `${username}-password`
  };
  madeHere.push(account);
  return account;
}

/** Everything this run registered, whether it went well or not. */
export function closeWhatWasMade() {
  return closeThem(madeHere.splice(0, madeHere.length));
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

/**
 * Ends the accounts a run made.
 *
 * Deactivating rather than signing out: a signed-out account is still in the homeserver's directory, and the
 * directory is what the example searches when somebody types a name into the invite box. Called at the end
 * of a check, and a failure to end one is not worth failing a check that otherwise passed — it is said and
 * stepped over, because `sweep:accounts` will find it later.
 */
export async function closeThem(...accounts) {
  // Once per person, not once per session. A check with the same account signed in on two devices hands both
  // of them over, and the second close is an account that is already gone answering as if something broke.
  const closed = new Set();
  for (const account of accounts.flat()) {
    if (!account?.client) continue;
    // Said, not skipped. A check that reshapes what it got back and drops the password would otherwise look
    // as if it had cleaned up after itself, and the accounts would pile up where nobody was looking.
    if (!account.password) {
      console.error(
        `could not close ${account.username ?? account.userId}: no password to prove it is theirs`
      );
      continue;
    }
    const who = account.userId ?? account.username;
    if (closed.has(who)) {
      await account.client.stop().catch(() => undefined);
      continue;
    }
    closed.add(who);
    // Closing an account is asking the homeserver, and the client will not ask until it is running. A check
    // that drives the browser never starts its own client — `registerAccount(..., { start: false })` — so it
    // is started here, with nothing to catch up on, purely to be able to say goodbye.
    await account.client.start({ waitForSync: false }).catch(() => undefined);
    await account.client.account
      .close(account.password)
      .catch(error => console.error(`could not close ${account.username}: ${error.message ?? error}`));
  }
}
