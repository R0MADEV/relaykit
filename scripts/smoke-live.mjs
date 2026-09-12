import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// The things that only exist while somebody is looking: typing, presence and read receipts.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const bob = { username: process.env.MATRIX_USER_B ?? "bob", password: process.env.MATRIX_PASSWORD_B ?? "bob-password" };

async function createClient(credentials, deviceName) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  const session = await client.login({ ...credentials, homeserver, deviceName });
  await client.start();
  return { client, userId: session.userId };
}

async function waitFor(description, check, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  let aliceSide;
  let bobSide;
  try {
    aliceSide = await createClient(alice, "RelayKit live smoke");
    bobSide = await createClient(bob, "RelayKit live smoke");

    const typing = [];
    const receipts = [];
    const presences = [];
    aliceSide.client.on("typing.changed", update => typing.push(update));
    aliceSide.client.on("receipt.received", receipt => receipts.push(receipt));
    aliceSide.client.on("presence.changed", presence => presences.push(presence));

    const conversation = await aliceSide.client.conversations.create({
      participantIds: [bobSide.userId],
      title: `RelayKit live smoke ${Date.now()}`,
      encrypted: false
    });
    await waitFor("Bob to be invited", async () => {
      const conversations = await bobSide.client.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await bobSide.client.conversations.join(conversation.id);

    // Somebody typing reaches the other side, and so does them stopping.
    await bobSide.client.conversations.typing(conversation.id, true);
    await waitFor("Alice to see Bob typing", () =>
      typing.some(update => update.conversationId === conversation.id && update.userIds.includes(bobSide.userId))
    );
    await bobSide.client.conversations.typing(conversation.id, false);
    await waitFor("Alice to see Bob stop typing", () =>
      typing.some(update => update.conversationId === conversation.id && !update.userIds.includes(bobSide.userId))
    );

    // Reading a message tells the person who sent it, and only once for the same point.
    const said = `live-${Date.now()}`;
    const sent = await aliceSide.client.messages.send(conversation.id, said);
    await waitFor("Bob to receive it", async () => {
      const messages = await bobSide.client.messages.list(conversation.id);
      return messages.some(message => message.body === said);
    });
    await bobSide.client.messages.markRead(conversation.id, sent.id);
    await waitFor("Alice to be told Bob read it", () =>
      receipts.some(receipt => receipt.userId === bobSide.userId && receipt.messageId === sent.id)
    );
    const readers = await aliceSide.client.messages.readBy(conversation.id, sent.id);
    const bobReadItTwice = readers.filter(receipt => receipt.userId === bobSide.userId).length > 1;
    if (bobReadItTwice) {
      throw new Error(`The same person is listed twice as having read it: ${JSON.stringify(readers)}`);
    }

    // Whether somebody is around reaches the other side. Which state it settles on is the homeserver's call:
    // a client that keeps syncing counts as activity, so a state set by hand is overwritten within a moment.
    // What is checked here is that it travels at all, not that it sticks.
    await bobSide.client.presence.set({ presence: "unavailable" });
    const seen = await waitFor("Alice to hear about Bob being around", () =>
      presences.find(presence => presence.userId === bobSide.userId)
    );
    await bobSide.client.presence.set({ presence: "online" });

    // Closing the application and opening it again: what was missed is there, and painting does not wait.
    const whileAway = `mientras-fuera-${Date.now()}`;
    await aliceSide.client.stop();
    await bobSide.client.messages.send(conversation.id, whileAway);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const openedAt = Date.now();
    await aliceSide.client.start({ waitForSync: false });
    const paintedIn = Date.now() - openedAt;

    // The point of not waiting: what was here last time is on screen before the homeserver has said anything.
    const painted = await aliceSide.client.conversations.list();
    if (!painted.some(item => item.id === conversation.id)) {
      throw new Error("Reopening showed nothing until the homeserver answered");
    }
    const messagesPainted = await aliceSide.client.messages.list(conversation.id);
    if (!messagesPainted.some(message => message.body === said)) {
      throw new Error("Reopening showed no messages until the homeserver answered");
    }
    await waitFor("Alice to catch up with what she missed", async () => {
      const messages = await aliceSide.client.messages.list(conversation.id);
      return messages.some(message => message.body === whileAway && !message.undecryptable);
    });

    console.log(`RelayKit live smoke check passed (typing, ${receipts.length} receipt(s), presence ${seen.presence}, reopened in ${paintedIn} ms)`);
  } finally {
    for (const side of [aliceSide, bobSide]) await side?.client.logout().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit live smoke check failed: ${error.message}`);
    process.exit(1);
  });
