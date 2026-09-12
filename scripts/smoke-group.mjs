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

    // A thread keeps its answers out of the conversation, and everyone can read them.
    const question = `thread-root-${Date.now()}`;
    const root = await alice.client.messages.send(conversation.id, question);
    await waitForMessage(bob, conversation.id, question);
    const answer = `thread-answer-${Date.now()}`;
    await bob.client.messages.send(conversation.id, answer, { threadId: root.id });
    const thread = await waitFor("the answer to be readable in the thread", async () => {
      const messages = await carol.client.messages.thread(conversation.id, root.id);
      return messages.find(message => message.body === answer && !message.undecryptable);
    });
    if (thread.threadId !== root.id) {
      throw new Error(`The answer hangs from ${thread.threadId} instead of the question`);
    }
    const timeline = await carol.client.messages.list(conversation.id);
    if (timeline.some(message => message.body === answer)) {
      throw new Error("The thread answer should not be in the middle of the conversation");
    }

    // Who is allowed to do what, and making somebody a moderator.
    const asOwner = await alice.client.conversations.permissions(conversation.id);
    if (!asOwner.canRemove || !asOwner.canRename) {
      throw new Error(`The person who created the conversation cannot moderate it: ${JSON.stringify(asOwner)}`);
    }
    const asMember = await bob.client.conversations.permissions(conversation.id);
    if (asMember.canRemove) {
      throw new Error("An ordinary member should not be able to throw anybody out");
    }
    await alice.client.conversations.setRole(conversation.id, bob.userId, "moderator");
    await waitFor("Bob to become a moderator", async () => {
      const permissions = await bob.client.conversations.permissions(conversation.id);
      return permissions.canRemove;
    });

    const unreadForCarol = await waitFor("Carol to count what she has not read", async () => {
      const conversations = await carol.client.conversations.list();
      const current = conversations.find(item => item.id === conversation.id);
      return (current?.unreadCount ?? 0) > 0 ? current.unreadCount : undefined;
    });

    // Conversations can be grouped into a space, which is not a conversation itself.
    const space = await alice.client.spaces.create({ title: `RelayKit space ${Date.now()}` });
    await alice.client.spaces.add(space.id, conversation.id);
    const grouped = await waitFor("the conversation to appear inside the space", async () => {
      const inside = await alice.client.spaces.conversations(space.id);
      return inside.find(item => item.id === conversation.id);
    });
    if (!grouped) throw new Error("The conversation is not inside the space");
    const listed = await alice.client.conversations.list();
    if (listed.some(item => item.id === space.id)) {
      throw new Error("A space must not be listed as an ordinary conversation");
    }
    await alice.client.spaces.remove(space.id, conversation.id);
    await waitFor("the conversation to leave the space", async () => {
      const inside = await alice.client.spaces.conversations(space.id);
      return inside.every(item => item.id !== conversation.id);
    });

    // When somebody leaves, the rest must see the group shrink.
    await carol.client.conversations.leave(conversation.id);
    const afterLeaving = await waitFor("the group to shrink for the others", async () => {
      const conversations = await bob.client.conversations.list();
      const current = conversations.find(item => item.id === conversation.id);
      return current && !current.participantIds.includes(carol.userId) ? current : undefined;
    });

    // A conversation can ask people to knock, and the person who knocks waits until somebody lets them in.
    await alice.client.conversations.setJoinRule(conversation.id, "knock");
    await waitFor("the conversation to ask people to knock", async () => {
      const conversations = await alice.client.conversations.list();
      return conversations.find(item => item.id === conversation.id)?.joinRule === "knock";
    });
    await carol.client.conversations.knock(conversation.id, { reason: "me he salido sin querer" });
    await waitFor("Alice to see Carol waiting at the door", async () => {
      const conversations = await alice.client.conversations.list();
      const current = conversations.find(item => item.id === conversation.id);
      return current?.knockingIds?.includes(carol.userId);
    });
    await alice.client.conversations.invite(conversation.id, carol.userId);
    await carol.client.conversations.join(conversation.id);
    const letIn = await waitFor("Carol to stop waiting once she is in", async () => {
      const conversations = await alice.client.conversations.list();
      const current = conversations.find(item => item.id === conversation.id);
      const stillWaiting = current?.knockingIds?.includes(carol.userId) ?? false;
      return current?.participantIds.includes(carol.userId) && !stillWaiting ? current : undefined;
    });
    if (!letIn) throw new Error("Carol was let in but is still listed as waiting");
    await carol.client.conversations.leave(conversation.id);
    await alice.client.conversations.setJoinRule(conversation.id, "invite");

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
