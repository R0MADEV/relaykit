import { createClient } from "matrix-js-sdk";
import { registerAccount } from "./fresh-accounts.mjs";

// A call between two machines that are each behind their own router cannot reach the other directly: both
// sides offer addresses that mean nothing outside their own network. TURN is the way out of that, and it is
// the homeserver that hands out the credentials for it.
//
// Everything checked until now happened on one machine, where both sides see each other and TURN is never
// needed. This asks the plain question instead: does this homeserver give a client somewhere to relay
// through? Without it, calls work here and stop working the moment two real people try.

async function run() {
  const account = await registerAccount("turn", "turn-check");

  // Asked through the SDK, which is what a call asks before it starts and where it gave up with
  // "failed to get TURN credentials! Proceeding with call anyway..."
  const client = createClient({
    baseUrl: process.env.MATRIX_HOMESERVER ?? "http://localhost:8008",
    userId: account.userId,
    accessToken: account.accessToken
  });

  const given = await client.turnServer().catch(error => {
    throw new Error(`The homeserver was asked for somewhere to relay through and said: ${error.message}`);
  });

  const uris = given.uris ?? [];
  if (uris.length === 0) {
    throw new Error("The homeserver handed out no relay at all, so a call cannot cross two networks");
  }
  if (!given.username || !given.password) {
    throw new Error(`A relay was named without credentials to use it: ${JSON.stringify(given)}`);
  }
  // The credentials are made from a shared secret and expire, which is the whole point: a relay that anybody
  // can use for ever is a relay anybody will use for everything.
  if (!(given.ttl > 0)) {
    throw new Error(`The credentials never expire, so anybody who sees them keeps the relay: ttl=${given.ttl}`);
  }

  await account.client.stop();
  console.log(`RelayKit turn smoke check passed (${uris.length} relay: ${uris.join(", ")})`);
}

run().catch(error => {
  console.error(`RelayKit turn smoke check failed: ${error.message}`);
  process.exit(1);
});
