import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("who is in a conversation, what each of them is, and who has not accepted yet", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob", "carol"] });

  // Making a conversation invites the others; they are not in it until they accept, and a screen showing
  // them as already there is a screen that says somebody is listening who is not.
  assert.deepEqual(await client.conversations.participants(conversation.id), [
    { userId: "alice", role: "admin", membership: "join", isUnderMe: false },
    { userId: "bob", role: "member", membership: "invite", isUnderMe: true },
    { userId: "carol", role: "member", membership: "invite", isUnderMe: true }
  ]);
  await client.stop();
});

test("whoever made it outranks everybody, and nobody outranks themselves", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.conversations.setRole(conversation.id, "bob", "admin");

  const inIt = await client.conversations.participants(conversation.id);

  // An admin may not act on another admin: a button that always fails is worse than no button.
  assert.equal(inIt.find(each => each.userId === "bob")?.isUnderMe, false);
  assert.equal(inIt.find(each => each.userId === "bob")?.role, "admin");
  await client.stop();
});

test("somebody made moderator is under an admin and over a member", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.conversations.setRole(conversation.id, "bob", "moderator");

  const inIt = await client.conversations.participants(conversation.id);

  assert.equal(inIt.find(each => each.userId === "bob")?.role, "moderator");
  assert.equal(inIt.find(each => each.userId === "bob")?.isUnderMe, true);
  await client.stop();
});

test("somebody shown the door is still in the list, so they can be let back in", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob", "carol"] });
  await client.conversations.ban(conversation.id, "bob", "spam");

  const inIt = await client.conversations.participants(conversation.id);

  assert.equal(inIt.find(each => each.userId === "bob")?.membership, "ban");
  assert.equal(inIt.find(each => each.userId === "carol")?.membership, "invite");
  await client.stop();
});
