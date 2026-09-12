import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// A room with a real crowd in it, because that is where a conversation list stops being cheap.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const crowd = Number(process.env.BENCH_CROWD ?? 200);

/**
 * Two things matrix-js-sdk throws from inside its own work, where nothing here can catch them: signing out
 * while a sync is in flight, and polling an experimental endpoint this homeserver does not implement. Both are
 * tolerated by name so a real problem still brings the run down.
 */
process.on("unhandledRejection", error => {
  const message = error instanceof Error ? error.message : String(error);
  const stopped = message.includes("MatrixClient has been stopped");
  const unsupportedByTheServer = message.includes("M_UNRECOGNIZED");
  if (stopped || unsupportedByTheServer) return;
  console.error(error);
  process.exit(1);
});

let requests = 0;
let syncBytes = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  requests += 1;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const response = await realFetch(input, init);
  if (!url.includes("/sync")) return response;
  // Reading the body to weigh it, and handing back a copy so the sdk still gets one.
  const body = await response.clone().arrayBuffer();
  syncBytes += body.byteLength;
  return response;
};

async function register(username) {
  const response = await realFetch(`${homeserver}/_matrix/client/v3/register`, {
    method: "POST",
    body: JSON.stringify({ username, password: "crowd-password", auth: { type: "m.login.dummy" }, inhibit_login: false })
  });
  if (!response.ok) throw new Error(`could not register ${username}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function join(session, roomId) {
  const response = await realFetch(`${homeserver}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: "{}"
  });
  if (!response.ok) throw new Error(`could not join: ${response.status} ${await response.text()}`);
}

async function time(name, work) {
  const started = performance.now();
  const result = await work();
  console.log(`${name.padEnd(44)} ${(performance.now() - started).toFixed(1).padStart(8)} ms`);
  return result;
}

/** Builds the crowd. Skipped when a room that already has one is named, so it can be measured again. */
async function buildTheCrowd() {
  const host = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  await host.login({ ...alice, homeserver, deviceName: "RelayKit crowd" });
  await host.start();
  const room = await host.conversations.create({
    participantIds: [],
    title: `RelayKit crowd ${Date.now()}`,
    public: true,
    encrypted: false
  });
  await host.conversations.setJoinRule(room.id, "public");

  const stamp = Date.now();
  await time(`sign up and let in ${crowd} people`, async () => {
    for (let index = 0; index < crowd; index += 1) {
      const session = await register(`crowd-${stamp}-${index}`);
      await join(session, room.id);
    }
  });
  await host.stop();
  return room.id;
}

async function main() {
  // Reusing a crowd that already exists, so the same room can be measured again under different settings.
  const roomId = process.env.BENCH_ROOM ?? await buildTheCrowd();
  console.log(`the room being measured is ${roomId}`);

  // A fresh session, which is what opening the application looks like for somebody in that room.
  const initialSyncLimit = Number(process.env.BENCH_SYNC_LIMIT ?? 20);
  // Shared on purpose: the second client is the same person opening the application again.
  const warmStorage = new InMemoryStorage();
  const arriving = new MessagingClient({
    adapter: new MatrixJsAdapter({ initialSyncLimit }),
    storage: warmStorage
  });
  await arriving.login({ ...alice, homeserver, deviceName: "RelayKit crowd arrival" });
  requests = 0;
  syncBytes = 0;
  await time("start and catch up", () => arriving.start());
  const startRequests = requests;
  const conversations = await time("list the conversations", () => arriving.conversations.list());

  // What an application that already has yesterday's data can paint, and how soon.
  const returning = new MessagingClient({
    adapter: new MatrixJsAdapter({ initialSyncLimit }),
    storage: warmStorage
  });
  await returning.login({ ...alice, homeserver, deviceName: "RelayKit crowd returning" });
  const paintedAt = performance.now();
  await returning.start({ waitForSync: false });
  const shown = await returning.conversations.list();
  console.log(`${"start without waiting and paint".padEnd(44)} ${(performance.now() - paintedAt).toFixed(1).padStart(8)} ms`);
  console.log(`${shown.length} conversations painted from what was already here`);

  // What an application that goes off screen and comes back pays, against starting from nothing.
  await returning.pause();
  const pickedUpAt = performance.now();
  await returning.resume();
  console.log(`${"put aside and picked up again".padEnd(44)} ${(performance.now() - pickedUpAt).toFixed(1).padStart(8)} ms`);
  await returning.pause();
  const pickedUpFast = performance.now();
  await returning.resume({ waitForSync: false });
  console.log(`${"picked up without waiting".padEnd(44)} ${(performance.now() - pickedUpFast).toFixed(1).padStart(8)} ms`);
  // Letting it settle before signing out. Signing out on top of a sync still in flight makes matrix-js-sdk
  // throw from inside its own event processing, where nothing here can catch it.
  await new Promise(resolve => setTimeout(resolve, 2000));
  await returning.logout().catch(() => undefined);
  await time("list them again", () => arriving.conversations.list());
  const crowded = conversations.find(item => item.id === roomId);
  const inTheRoom = crowded?.participantIds.length ?? 0;
  console.log(`the crowded room has ${inTheRoom} people, ${conversations.length} conversations in all`);
  const expected = Number(process.env.BENCH_EXPECT_PEOPLE ?? 0);
  if (expected > 0 && inTheRoom < expected) {
    throw new Error(`the room lists ${inTheRoom} people and there are ${expected}: the list is not complete`);
  }
  console.log(`requests while starting ${String(startRequests).padStart(21)}`);
  console.log(`kilobytes of sync while starting ${String(Math.round(syncBytes / 1024)).padStart(10)}`);
  console.log(`messages asked for per conversation ${String(initialSyncLimit).padStart(7)}`);
  await arriving.logout().catch(() => undefined);
}

main().then(() => process.exit(0)).catch(error => {
  console.error(`crowd measurement failed: ${error.message}`);
  process.exit(1);
});
