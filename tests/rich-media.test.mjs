import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const recording = { name: "nota.ogg", mimeType: "audio/ogg", data: new Uint8Array([79, 103, 103, 83]) };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("a place can be sent, and it arrives as a place and not as text", async () => {
  const { client, conversation } = await startClient();

  const sent = await client.messages.sendLocation(conversation.id, {
    latitude: 43.2630,
    longitude: -2.9350,
    description: "Bilbao"
  });

  assert.equal(sent.location?.latitude, 43.2630);
  assert.equal(sent.location?.longitude, -2.9350);
  assert.equal(sent.location?.description, "Bilbao");
  const listed = await client.messages.list(conversation.id);
  assert.equal(listed.at(-1)?.location?.description, "Bilbao");
  await client.stop();
});

test("a place outside the world is refused before reaching the server", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.messages.sendLocation(conversation.id, { latitude: 91, longitude: 0 }), /latitude/i);
  await assert.rejects(client.messages.sendLocation(conversation.id, { latitude: 0, longitude: 181 }), /longitude/i);
  await client.stop();
});

test("a voice note carries how long it lasts, so it can be drawn before playing it", async () => {
  const { client, conversation } = await startClient();

  const sent = await client.messages.sendVoice(conversation.id, recording, {
    durationMs: 3200,
    waveform: [0, 512, 1024, 256]
  });

  assert.equal(sent.attachment?.voice?.durationMs, 3200);
  assert.deepEqual(sent.attachment?.voice?.waveform, [0, 512, 1024, 256]);
  assert.equal(sent.attachment?.name, "nota.ogg");
  await client.stop();
});

test("a voice note without a length is refused, because there is nothing to draw", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.messages.sendVoice(conversation.id, recording, { durationMs: 0 }), /length/i);
  await client.stop();
});

test("a voice note is downloaded like any other file", async () => {
  const { client, conversation } = await startClient();
  const sent = await client.messages.sendVoice(conversation.id, recording, { durationMs: 1000 });

  const downloaded = await client.media.download(sent.attachment);

  assert.deepEqual(new Uint8Array(downloaded), recording.data);
  await client.stop();
});
