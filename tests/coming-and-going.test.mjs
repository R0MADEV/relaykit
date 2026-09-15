import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, createConversationList } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("leaving a conversation says so, like joining one does", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const said = [];
  client.on("conversation.left", id => said.push(id));

  await client.conversations.leave(conversation.id);

  // Joining announces itself and leaving did not, so anything following the list was told when somebody
  // arrived and never when they left. A screen that paints from it keeps the conversation for ever.
  //
  // Its own event rather than an updated conversation: one this account has is one it is in or invited to,
  // and there is no conversation left to hand over.
  assert.deepEqual(said, [conversation.id]);
});

test("a conversation that was left drops out of a live list on its own", async () => {
  const { client } = await startClient();
  const staying = await client.conversations.create({ participantIds: ["bob"], title: "Se queda" });
  const going = await client.conversations.create({ participantIds: ["bob"], title: "Se va" });
  const list = createConversationList(client);
  await list.refresh();
  assert.equal(list.get().length, 2);

  await client.conversations.leave(going.id);
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(
    list.get().map(each => each.id),
    [staying.id]
  );
  list.stop();
  await client.stop();
});

test("a conversation somebody joined is in the live list without asking for everything again", async () => {
  const { adapter, client } = await startClient();
  const list = createConversationList(client);
  await list.refresh();
  const invited = adapter.receiveInvitation("bob");

  await client.conversations.join(invited.id);
  await new Promise(resolve => setTimeout(resolve, 20));

  const found = list.get().find(each => each.id === invited.id);
  assert.equal(found?.membership, "join", "it was joined and the list still says it is an invitation");
  list.stop();
  await client.stop();
});
