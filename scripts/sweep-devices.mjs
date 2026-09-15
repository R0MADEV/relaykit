// Closes the sessions the checks left open on the development accounts.
//
// Every check that signs in leaves a device behind, and nothing ever signed them out: alice had three
// hundred and sixty-four. It is not only untidy. A device is what encrypted messages are encrypted *for*, so
// hundreds of dead ones means every message sent to that account is encrypted hundreds of times over, and the
// list of sessions somebody opens to check nobody is reading their conversations is unreadable.
//
// Everything except the session doing the sweeping. Anything signed in as one of these accounts right now —
// a browser with the example open — is signed out, which is the point.
import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";
import { surviveWhatTheSdkThrows, barelyAnyHistory } from "./surviving-the-sdk.mjs";

surviveWhatTheSdkThrows();

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const accounts = (process.env.RELAYKIT_SWEEP_USERS ?? "alice,bob,carol").split(",");

async function sweep(username) {
  const password = `${username}-password`;
  const client = new MessagingClient({
    adapter: new MatrixJsAdapter(barelyAnyHistory),
    storage: new InMemoryStorage()
  });
  await client.start(await client.login({ homeserver, username, password, deviceName: "RelayKit sweep" }));
  const devices = await client.devices.list();
  const others = devices.filter(device => !device.isCurrent).map(device => device.id);
  // In pieces: a homeserver asked to close three hundred sessions in one request takes its time about it,
  // and one that times out has closed an unknown number of them.
  let closed = 0;
  for (let from = 0; from < others.length; from += 20) {
    const piece = others.slice(from, from + 20);
    const went = await client.devices.signOut(piece, { password }).then(
      () => true,
      () => false
    );
    if (went) closed += piece.length;
  }
  const left = await client.devices.list().catch(() => []);
  await client.logout().catch(() => undefined);
  return { username, had: devices.length, closed, left: left.length };
}

for (const username of accounts) {
  const done = await sweep(username).catch(error => ({ username, failed: error.message ?? String(error) }));
  console.log(`RELAYKIT_SWEEP_DEVICES ${JSON.stringify(done)}`);
}
process.exit(0);
