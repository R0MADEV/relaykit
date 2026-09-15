// Ends the accounts the checks made and did not take away.
//
// Every check registers an account of its own and throws it at the wall, which is right: a shared account
// carries whatever the last run did to it, and a check failing for last week's reasons checks nothing. What
// was wrong was leaving them there afterwards — the homeserver's people directory is the same directory the
// example searches, so somebody typing a name into the invite box was offered seven hundred strangers.
//
// Only accounts this repository makes, recognised by the name the checks give them and by a password that
// follows from it. Anything else on the homeserver is left alone.
import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";
import { surviveWhatTheSdkThrows, barelyAnyHistory } from "./surviving-the-sdk.mjs";

surviveWhatTheSdkThrows();

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";

/**
 * The three this development environment is built around, which are nobody's to sweep.
 *
 * Named rather than pattern-matched, because their passwords follow the very rule that says an account is a
 * throwaway — `alice-password` looks exactly like `chat-1a2b3c4d-password`. The only thing that tells them
 * apart is that somebody decided these three stay.
 */
const theOnesThatStay = new Set((process.env.RELAYKIT_KEEP ?? "alice,bob,carol").split(","));

/**
 * Whether an account is one of ours, asked by trying to be it.
 *
 * Every account a check makes takes `<name>-password`, so being able to sign in with that is proof. Better
 * than a list of name patterns, which went stale the moment somebody added a check: this cannot touch an
 * account that is not ours, because it cannot get into one.
 */
async function endIfItIsOurs(username) {
  if (theOnesThatStay.has(username)) return "kept";
  const client = new MessagingClient({
    adapter: new MatrixJsAdapter(barelyAnyHistory),
    storage: new InMemoryStorage()
  });
  const password = `${username}-password`;
  const session = await client
    .login({ homeserver, username, password, deviceName: "RelayKit sweep" })
    .catch(() => undefined);
  if (!session) return "not ours";
  try {
    await client.start(session);
    await client.account.close(password);
    return "closed";
  } catch {
    return "would not close";
  }
}

/** Who is on this homeserver, asked of its own directory — the same one the example searches. */
async function everybody() {
  const asking = new MessagingClient({
    adapter: new MatrixJsAdapter(barelyAnyHistory),
    storage: new InMemoryStorage()
  });
  const session = await asking.login({
    homeserver,
    username: process.env.MATRIX_USER_A ?? "alice",
    password: process.env.MATRIX_PASSWORD_A ?? "alice-password",
    deviceName: "RelayKit sweep"
  });
  await asking.start(session);
  // Asked for in pieces: a directory search answers a page at a time, and one letter at a time is the
  // simplest way to walk the whole of it without an administrator's token.
  const found = new Map();
  for (const letter of "abcdefghijklmnopqrstuvwxyz0123456789") {
    for (const person of await asking.users.search(letter, { limit: 200 }).catch(() => [])) {
      found.set(person.id, person);
    }
  }
  await asking.stop();
  return [...found.values()];
}

/** The local part of an identifier: `@chat-1a2b3c4d:localhost` is `chat-1a2b3c4d`. */
function nameOf(userId) {
  return userId.replace(/^@/, "").split(":")[0];
}

const everyone = await everybody();
const counted = { found: everyone.length, closed: 0, kept: 0, "not ours": 0, "would not close": 0 };
for (const person of everyone) {
  const what = await endIfItIsOurs(nameOf(person.id));
  counted[what] += 1;
}
console.log(`RELAYKIT_SWEEP_ACCOUNTS ${JSON.stringify(counted)}`);
process.exit(0);
