import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const people = [
  { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" },
  { username: process.env.MATRIX_USER_B ?? "bob", password: process.env.MATRIX_PASSWORD_B ?? "bob-password" },
  { username: process.env.MATRIX_USER_C ?? "carol", password: process.env.MATRIX_PASSWORD_C ?? "carol-password" }
];

async function createClient({ username, password }) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter() });
  const session = await client.login({ ...username && { username }, password, homeserver, deviceName: "RelayKit group smoke" });
  await client.start();
  return { client, userId: session.userId, username };
}

async function waitFor(description, check, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function waitForMessage(member, conversationId, body) {
  return waitFor(`${member.username} to read "${body}"`, async () => {
    const messages = await member.client.messages.list(conversationId);
    return messages.find(message => message.body === body && !message.undecryptable);
  });
}

async function main() {
  const members = [];
  try {
    for (const person of people) members.push(await createClient(person));
    const [alice, bob, carol] = members;

    const conversation = await alice.client.conversations.create({
      participantIds: [bob.userId, carol.userId],
      title: "RelayKit group smoke"
    });

    // Everyone joins before anything is said, which is what a group invitation looks like in practice.
    for (const member of [bob, carol]) {
      await waitFor(`${member.username} to be invited`, async () => {
        const conversations = await member.client.conversations.list();
        return conversations.find(item => item.id === conversation.id);
      });
      await member.client.conversations.join(conversation.id);
    }

    const everyone = await waitFor("the three participants to be in the conversation", async () => {
      const conversations = await alice.client.conversations.list();
      const current = conversations.find(item => item.id === conversation.id);
      return current && members.every(member => current.participantIds.includes(member.userId)) ? current : undefined;
    });
    if (everyone.participantIds.length < 3) {
      throw new Error(`The group has ${everyone.participantIds.length} participants: ${everyone.participantIds}`);
    }

    // Every member must be able to read what any other member writes.
    for (const sender of members) {
      const body = `group-${sender.username}-${Date.now()}`;
      await sender.client.messages.send(conversation.id, body);
      for (const reader of members.filter(member => member !== sender)) {
        await waitForMessage(reader, conversation.id, body);
      }
    }

    const unreadForCarol = await waitFor("Carol to count what she has not read", async () => {
      const conversations = await carol.client.conversations.list();
      const current = conversations.find(item => item.id === conversation.id);
      return (current?.unreadCount ?? 0) > 0 ? current.unreadCount : undefined;
    });

    // When somebody leaves, the rest must see the group shrink.
    await carol.client.conversations.leave(conversation.id);
    const afterLeaving = await waitFor("the group to shrink for the others", async () => {
      const conversations = await bob.client.conversations.list();
      const current = conversations.find(item => item.id === conversation.id);
      return current && !current.participantIds.includes(carol.userId) ? current : undefined;
    });

    const stillTalking = `after-leaving-${Date.now()}`;
    await alice.client.messages.send(conversation.id, stillTalking);
    await waitForMessage(bob, conversation.id, stillTalking);

    console.log(`RelayKit group smoke check passed (3 members, unread ${unreadForCarol}, ${afterLeaving.participantIds.length} left talking)`);
  } finally {
    for (const member of members) await member.client.logout().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit group smoke check failed: ${error.message}`);
    process.exit(1);
  });
