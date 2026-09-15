import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, SdkError } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("a conversation left is still in the list until it is forgotten", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });

  await client.conversations.leave(conversation.id);
  await client.conversations.forget(conversation.id);

  const left = await client.conversations.list();
  assert.equal(
    left.some(each => each.id === conversation.id),
    false,
    "a conversation forgotten is gone from the list"
  );
  await client.stop();
});

test("a conversation can be filed under a name of your own, and taken back out", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });

  await client.conversations.tag(conversation.id, "guardias");
  assert.deepEqual(await client.conversations.tags(conversation.id), ["guardias"]);

  await client.conversations.tag(conversation.id, "urgente");
  assert.deepEqual([...(await client.conversations.tags(conversation.id))].sort(), ["guardias", "urgente"]);

  await client.conversations.untag(conversation.id, "guardias");
  assert.deepEqual(await client.conversations.tags(conversation.id), ["urgente"]);
  await client.stop();
});

test("an empty tag is refused before it reaches the homeserver", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });

  await assert.rejects(client.conversations.tag(conversation.id, "   "), /tag/i);
  await client.stop();
});

test("the homeserver says which room versions it admits, and which it prefers", async () => {
  const { client } = await startClient();

  const versions = await client.conversations.versions();

  assert.ok(versions.available.includes(versions.preferred));
  assert.ok(versions.available.length > 0);
  await client.stop();
});

test("an account remembers a setting of its own, and reads it back", async () => {
  const { client } = await startClient();

  assert.equal(await client.account.remembered("deitu.tema"), undefined);
  await client.account.remember("deitu.tema", { oscuro: true });

  assert.deepEqual(await client.account.remembered("deitu.tema"), { oscuro: true });
  await client.stop();
});

test("a setting with no name is refused", async () => {
  const { client } = await startClient();
  await assert.rejects(client.account.remember("  ", { algo: 1 }), /name/i);
  await client.stop();
});

test("a password can be changed, and the old one is required", async () => {
  const { client } = await startClient();

  await client.account.changePassword("token", "otra-cosa");
  await assert.rejects(client.account.changePassword("la-que-no-es", "tercera"), /password/i);
  await client.stop();
});

test("a space says what is inside it, and how deep", async () => {
  const { client } = await startClient();
  const space = await client.spaces.create({ title: "Equipo" });
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "guardias" });
  await client.spaces.add(space.id, conversation.id);

  const inside = await client.spaces.children(space.id);

  assert.equal(inside.length, 1);
  assert.equal(inside[0].conversationId, conversation.id);
  assert.equal(inside[0].title, "guardias");
  await client.stop();
});

test("a space inside a space is a level further down, and is only reached once", async () => {
  const { client } = await startClient();
  const top = await client.spaces.create({ title: "Work" });
  const inner = await client.spaces.create({ title: "Design" });
  const deep = await client.conversations.create({ participantIds: ["bob"], title: "Icons" });
  const both = await client.conversations.create({ participantIds: ["bob"], title: "Announcements" });
  await client.spaces.add(top.id, inner.id);
  await client.spaces.add(inner.id, deep.id);
  // In two places at once, so the nearer way in is the one that has to win.
  await client.spaces.add(inner.id, both.id);
  await client.spaces.add(top.id, both.id);

  const inside = await client.spaces.children(top.id);
  const at = id => inside.filter(child => child.conversationId === id);

  assert.equal(at(inner.id)[0].depth, 1);
  assert.equal(at(deep.id).length, 1, "a space inside a space is still listed");
  assert.equal(at(deep.id)[0].depth, 2, "two levels in is two levels down");
  assert.equal(at(both.id).length, 1, "a conversation in two places is still one conversation");
  assert.equal(at(both.id)[0].depth, 1, "reached by the shortest way in");
});

test("an address is added to an account only after the person proves it is theirs", async () => {
  const { client, adapter } = await startClient();

  const asked = await client.account.addEmail("alice@deitu.example");
  assert.ok(asked.id, "the homeserver says which request this is, so the proof can be matched to it");
  assert.deepEqual(await client.account.addresses(), [], "nothing is added until it is proved");

  // The person clicks the link in the message. Then, and only then, it counts.
  adapter.proveAddress(asked.id);
  await client.account.confirmEmail(asked, "token");

  const [added] = await client.account.addresses();
  assert.equal(added.address, "alice@deitu.example");
  assert.equal(added.kind, "email");
});

test("adding an address without the password is refused, however well proved it is", async () => {
  const { client, adapter } = await startClient();
  const asked = await client.account.addEmail("alice@deitu.example");
  adapter.proveAddress(asked.id);
  await assert.rejects(() => client.account.confirmEmail(asked, "la-que-no-es"), SdkError);
  assert.deepEqual(await client.account.addresses(), []);
});

test("an address not proved is refused, and nothing is added", async () => {
  const { client } = await startClient();
  const asked = await client.account.addEmail("nobody@deitu.example");
  await assert.rejects(() => client.account.confirmEmail(asked, "token"), SdkError);
  assert.deepEqual(await client.account.addresses(), []);
});

test("an address can be taken off an account", async () => {
  const { client, adapter } = await startClient();
  const asked = await client.account.addEmail("alice@deitu.example");
  adapter.proveAddress(asked.id);
  await client.account.confirmEmail(asked, "token");

  await client.account.removeAddress("email", "alice@deitu.example");

  assert.deepEqual(await client.account.addresses(), []);
});

test("something that is not an address is refused before the homeserver is asked", async () => {
  const { client } = await startClient();
  await assert.rejects(() => client.account.addEmail("no-es-un-correo"), SdkError);
});

test("a forgotten password is reset with what arrives by mail, and not without it", async () => {
  const { client, adapter } = await startClient();
  await client.stop();

  const asked = await client.resetPassword("memory://test", "alice@deitu.example");
  await assert.rejects(
    () => client.finishResettingPassword("memory://test", asked, "nueva-contraseña"),
    SdkError,
    "nothing was proved yet"
  );

  adapter.proveAddress(asked.id);
  await client.finishResettingPassword("memory://test", asked, "nueva-contraseña");
  assert.equal(adapter.passwordNow(), "nueva-contraseña");
});

test("a new password too short to be one is refused before anything is sent", async () => {
  const { client } = await startClient();
  await client.stop();
  const asked = await client.resetPassword("memory://test", "alice@deitu.example");
  await assert.rejects(() => client.finishResettingPassword("memory://test", asked, "corta"), SdkError);
});
