import { deflateSync } from "node:zlib";
import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Everything a conversation is besides plain text: rich text, mentions, a description, a picture, pinning.
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

function waitForMessage(who, conversationId, body) {
  return waitFor(`the other side to read "${body}"`, async () => {
    const messages = await who.client.messages.list(conversationId);
    return messages.find(message => message.body === body && !message.undecryptable);
  });
}

/**
 * A real picture, big enough that a media server resizing it is visible in the bytes. Eight bytes of PNG magic
 * cannot be resized, so proving anything about sizes needs an image that is actually an image.
 */
function pngOf(side) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < side; y += 1) {
    const row = Buffer.alloc(1 + side * 3);
    for (let x = 0; x < side; x += 1) {
      row[1 + x * 3] = (x * 7 + y * 13) % 256;
      row[2 + x * 3] = (x * 31 + y * 3) % 256;
      row[3 + x * 3] = (x * 17 + y * 91) % 256;
    }
    rows.push(row);
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]));
}

function pngChunk(type, body) {
  const head = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(head));
  return Buffer.concat([length, head, checksum]);
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

async function main() {
  let aliceSide;
  let bobSide;
  try {
    aliceSide = await createClient(alice, "RelayKit chat smoke");
    bobSide = await createClient(bob, "RelayKit chat smoke");

    const conversation = await aliceSide.client.conversations.create({
      participantIds: [bobSide.userId],
      title: `RelayKit chat smoke ${Date.now()}`
    });
    await waitFor("Bob to be invited", async () => {
      const conversations = await bobSide.client.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await bobSide.client.conversations.join(conversation.id);

    // Bob speaks first so both sides know each other's devices before anything is encrypted.
    const hello = `hola-${Date.now()}`;
    await bobSide.client.messages.send(conversation.id, hello);
    await waitForMessage(aliceSide, conversation.id, hello);

    // Rich text and a mention travel encrypted and arrive whole.
    const shouted = `importante-${Date.now()}`;
    await aliceSide.client.messages.send(conversation.id, shouted, {
      formattedBody: `<strong>${shouted}</strong>`,
      mentions: { userIds: [bobSide.userId] }
    });
    const asBobSees = await waitForMessage(bobSide, conversation.id, shouted);
    if (asBobSees.formattedBody !== `<strong>${shouted}</strong>`) {
      throw new Error(`Bob lost the formatting: ${asBobSees.formattedBody}`);
    }
    if (!asBobSees.mentions?.userIds?.includes(bobSide.userId)) {
      throw new Error(`Bob was not told he was named: ${JSON.stringify(asBobSees.mentions)}`);
    }

    // An action and a notice are read as what they are, not as ordinary text.
    const acted = `saluda-${Date.now()}`;
    await aliceSide.client.messages.send(conversation.id, acted, { kind: "action" });
    const action = await waitForMessage(bobSide, conversation.id, acted);
    if (action.kind !== "action") throw new Error(`The action arrived as ${action.kind}`);

    // A voice note travels encrypted, is told apart from an audio file, and can be played by the other side.
    const recording = new Uint8Array(64).map((_, index) => (index * 7) % 256);
    const note = await aliceSide.client.messages.sendVoice(
      conversation.id,
      { name: "nota.ogg", mimeType: "audio/ogg", data: recording },
      { durationMs: 3200, waveform: [0, 512, 1024, 256] }
    );
    const asVoice = await waitFor("Bob to receive the voice note", async () => {
      const messages = await bobSide.client.messages.list(conversation.id);
      return messages.find(message => message.id === note.id && message.attachment?.voice);
    });
    if (asVoice.attachment.voice.durationMs !== 3200) {
      throw new Error(`The voice note lost its length: ${JSON.stringify(asVoice.attachment.voice)}`);
    }
    const played = await bobSide.client.media.download(asVoice.attachment);
    if (Buffer.compare(Buffer.from(played), Buffer.from(recording)) !== 0) {
      throw new Error("The voice note did not come back as it was recorded");
    }

    // A place arrives as a place, not as a line of coordinates in the middle of the conversation.
    const place = await aliceSide.client.messages.sendLocation(conversation.id, {
      latitude: 43.263,
      longitude: -2.935,
      description: "Bilbao"
    });
    const asPlace = await waitFor("Bob to receive the place", async () => {
      const messages = await bobSide.client.messages.list(conversation.id);
      return messages.find(message => message.id === place.id && message.location);
    });
    if (asPlace.location.description !== "Bilbao" || asPlace.location.latitude !== 43.263) {
      throw new Error(`The place arrived wrong: ${JSON.stringify(asPlace.location)}`);
    }

    // What the conversation is about, and its picture, reach the other side.
    const topic = `de esto hablamos ${Date.now()}`;
    await aliceSide.client.conversations.setTopic(conversation.id, topic);
    await waitFor("Bob to read the description", async () => {
      const conversations = await bobSide.client.conversations.list();
      return conversations.find(item => item.id === conversation.id)?.topic === topic;
    });
    const picture = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await aliceSide.client.conversations.setAvatar(conversation.id, { data: picture, mimeType: "image/png" });
    await waitFor("Bob to see the picture", async () => {
      const conversations = await bobSide.client.conversations.list();
      return conversations.find(item => item.id === conversation.id)?.avatar !== undefined;
    });

    // Painting a list of people: the picture comes back at the size it will be shown, not at the size it was
    // uploaded. A screen full of faces is dozens of these, so asking for the original every time is the
    // difference between a list that opens and one that downloads megabytes to throw almost all of them away.
    const portrait = pngOf(256);
    await aliceSide.client.users.setAvatar({ data: portrait, mimeType: "image/png" });
    const whole = await waitFor("the picture to be readable whole", async () => {
      const image = await aliceSide.client.users.avatar(aliceSide.userId).catch(() => undefined);
      return image && image.data.byteLength > 0 ? image : undefined;
    });
    const small = await aliceSide.client.users.avatar(aliceSide.userId, { size: 32 });
    if (!small) throw new Error("Asking for a picture at a size gave nothing back");
    if (small.data.byteLength >= whole.data.byteLength) {
      throw new Error(`A picture asked for small came back at ${small.data.byteLength} of ${whole.data.byteLength} bytes`);
    }
    const savedByAsking = Math.round(whole.data.byteLength / small.data.byteLength);

    // Finding somebody by the name they go by, which is the only way to invite anybody from a screen: nobody
    // types a full Matrix identifier from memory.
    const searchedFor = (process.env.MATRIX_USER_B ?? "bob");
    const whoWasFound = await waitFor("the directory to know Bob", async () => {
      const people = await aliceSide.client.users.search(searchedFor);
      return people.find(person => person.id === bobSide.userId);
    });
    if (!whoWasFound) throw new Error(`Looking for ${searchedFor} did not find ${bobSide.userId}`);

    // A pinned message can be found later, and it is readable, not a locked box.
    await aliceSide.client.conversations.pin(conversation.id, asBobSees.id);
    const pinned = await waitFor("the pinned message to be readable by Bob", async () => {
      const listed = await bobSide.client.conversations.pinned(conversation.id);
      return listed.find(message => message.id === asBobSees.id);
    });
    if (pinned.undecryptable || pinned.body !== shouted) {
      throw new Error(`The pinned message cannot be read: ${JSON.stringify(pinned)}`);
    }
    await aliceSide.client.conversations.unpin(conversation.id, asBobSees.id);
    await waitFor("the message to stop being pinned", async () => {
      const listed = await bobSide.client.conversations.pinned(conversation.id);
      return listed.every(message => message.id !== asBobSees.id);
    });

    // Passing a file on to another conversation means fetching it and sending it again, because the copy here is
    // locked with a key the other conversation does not have.
    const elsewhere = await aliceSide.client.conversations.create({
      participantIds: [bobSide.userId],
      title: `RelayKit chat smoke reenvio ${Date.now()}`
    });
    await waitFor("Bob to be invited to the other conversation", async () => {
      const conversations = await bobSide.client.conversations.list();
      return conversations.find(item => item.id === elsewhere.id);
    });
    await bobSide.client.conversations.join(elsewhere.id);
    const greeting = `otra-${Date.now()}`;
    await bobSide.client.messages.send(elsewhere.id, greeting);
    await waitForMessage(aliceSide, elsewhere.id, greeting);

    const passedOn = await aliceSide.client.messages.forward(note.id, elsewhere.id);
    const asForwarded = await waitFor("Bob to receive the voice note that was passed on", async () => {
      const messages = await bobSide.client.messages.list(elsewhere.id);
      return messages.find(message => message.id === passedOn.id && message.attachment?.voice);
    });
    const playedAgain = await bobSide.client.media.download(asForwarded.attachment);
    if (Buffer.compare(Buffer.from(playedAgain), Buffer.from(recording)) !== 0) {
      throw new Error("The voice note did not survive being passed on");
    }
    if (asForwarded.attachment.source === asVoice.attachment.source) {
      throw new Error("The file was pointed at instead of being sent again");
    }

    // Throwing away the key means whatever is said next is locked with a new one, and the people who are still
    // here get it without noticing. Somebody who kept the old key keeps only what was said before.
    await aliceSide.client.conversations.rotateKeys(conversation.id);
    const afterRotating = `tras-rotar-${Date.now()}`;
    await aliceSide.client.messages.send(conversation.id, afterRotating);
    await waitForMessage(bobSide, conversation.id, afterRotating);

    // Silencing a conversation is a decision that belongs to the person, not to the room.
    await bobSide.client.conversations.setNotifications(conversation.id, "none");
    await waitFor("the conversation to be silent for Bob", async () => {
      const conversations = await bobSide.client.conversations.list();
      return conversations.find(item => item.id === conversation.id)?.notifications === "none";
    });
    await bobSide.client.conversations.setNotifications(conversation.id, "all");

    console.log(`RelayKit chat smoke check passed (rich text, mention, action, voice note, place, forwarding, new key, description, picture ${savedByAsking}x smaller when asked small, ${whoWasFound.id} found by name, pinning, silence)`);
  } finally {
    for (const side of [aliceSide, bobSide]) await side?.client.logout().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit chat smoke check failed: ${error.message}`);
    process.exit(1);
  });
