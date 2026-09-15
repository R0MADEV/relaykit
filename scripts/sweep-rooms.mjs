// Sweeps the development accounts clean of the rooms the checks left behind.
//
// Every check and smoke makes rooms and most do not take them away. Hundreds of them is not only untidy: the
// example opens with a window over the most recent conversations, and an account with seven hundred rooms
// syncs differently from the one anybody actually has. So this is a correctness tool, not housekeeping.
//
// It leaves and then forgets, in that order, because a room forgotten while still in it comes back.
import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";
import { InMemoryStorage } from "@relaykit/in-memory";

// matrix-js-sdk fetches thread roots while it syncs, and on a room whose history this account cannot see the
// homeserver answers 403. The SDK does not catch it, so in node it takes the process with it. Nothing here
// asked for that request and nothing here can wrap it, so it is noted and stepped over.
process.on("unhandledRejection", error => {
  console.log(`RELAYKIT_SWEEP_STEPPED_OVER ${error instanceof Error ? error.message : String(error)}`);
});

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const accounts = (process.env.RELAYKIT_SWEEP_USERS ?? "alice,bob,carol").split(",");

/** What the checks call the rooms they make. Anything else is left alone: this only sweeps its own mess. */
const madeByAcheck = [
  /^RelayKit /,
  /^unasked-\d/,
  /^encrypted-\d/,
  /^cifrada-\d/,
  /^calls \d/,
  /^conference$/,
  /^Seed \d/,
  /^prueba-\d/,
  /^chat-[ab]-/,
  /^check-(account|mail)-/,
  /^archivo$/
];

async function sweep(username) {
  const client = new MessagingClient({
    adapter: new MatrixJsAdapter(),
    storage: new InMemoryStorage()
  });
  const session = await client.login({
    homeserver,
    username,
    password: `${username}-password`,
    deviceName: "RelayKit sweep"
  });
  await client.start(session);

  const mine = await client.conversations.list();
  const rubbish = mine.filter(each => madeByAcheck.some(looksLike => looksLike.test(each.title ?? "")));
  let swept = 0;
  for (const conversation of rubbish) {
    await client.conversations.leave(conversation.id).catch(() => undefined);
    await client.conversations.forget(conversation.id).catch(() => undefined);
    swept += 1;
  }
  await client.stop();
  return { username, had: mine.length, swept, left: mine.length - swept };
}

for (const username of accounts) {
  const done = await sweep(username).catch(error => ({ username, failed: error.message }));
  console.log(`RELAYKIT_SWEEP ${JSON.stringify(done)}`);
}
process.exit(0);
