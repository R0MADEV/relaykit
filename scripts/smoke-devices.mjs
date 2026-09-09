import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const bob = { username: process.env.MATRIX_USER_B ?? "bob", password: process.env.MATRIX_PASSWORD_B ?? "bob-password" };

async function createClient(credentials, deviceName) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter() });
  const session = await client.login({ ...credentials, homeserver, deviceName });
  await client.start();
  return { client, userId: session.userId, deviceId: session.deviceId, deviceName };
}

async function waitFor(description, check, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForReadable(device, conversationId, body) {
  const found = await waitFor(`${device.deviceName} to read "${body}"`, async () => {
    const messages = await device.client.messages.list(conversationId);
    const message = messages.find(item => item.body === body);
    return message && !message.undecryptable ? message : undefined;
  }, 60).catch(async error => {
    const messages = await device.client.messages.list(conversationId);
    const seen = messages.map(item => `${item.undecryptable ? "[cifrado]" : item.body.slice(0, 20)}`);
    throw new Error(`${error.message} | ${device.deviceName} ve ${messages.length}: ${seen.join(" / ")}`);
  });
  return found;
}

async function main() {
  const devices = [];
  let bobDevice;
  try {
    // The same person on two devices at once, which is what anyone with a laptop and a phone has.
    devices.push(await createClient(alice, "laptop"));
    devices.push(await createClient(alice, "phone"));
    const [laptop, phone] = devices;
    if (laptop.deviceId === phone.deviceId) {
      throw new Error("Both sessions got the same device, so this proves nothing");
    }
    bobDevice = await createClient(bob, "bob");

    const conversation = await laptop.client.conversations.open(bobDevice.userId);
    await waitFor("Bob to be invited", async () => {
      const conversations = await bobDevice.client.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await bobDevice.client.conversations.join(conversation.id);

    // Bob speaks first, which is also how Alice's devices learn that he is really in the conversation.
    // A message encrypted before the sender has seen somebody join cannot be read by that person.
    const fromBob = `bob-${Date.now()}`;
    await bobDevice.client.messages.send(conversation.id, fromBob);
    const seenOnLaptop = await waitForReadable(laptop, conversation.id, fromBob);
    await waitForReadable(phone, conversation.id, fromBob);

    // What one device sends, the other device of the same person must be able to read.
    const fromLaptop = `laptop-${Date.now()}`;
    await laptop.client.messages.send(conversation.id, fromLaptop);
    await waitForReadable(phone, conversation.id, fromLaptop);
    await waitForReadable(bobDevice, conversation.id, fromLaptop);

    // Reading on one device clears the count on the other, because the receipt belongs to the person.
    await waitFor("the phone to count the message as unread", async () => {
      const conversations = await phone.client.conversations.list();
      return (conversations.find(item => item.id === conversation.id)?.unreadCount ?? 0) > 0;
    });
    await laptop.client.messages.markRead(conversation.id, seenOnLaptop.id);
    await waitFor("the phone to see it as read", async () => {
      const conversations = await phone.client.conversations.list();
      return conversations.find(item => item.id === conversation.id)?.unreadCount === 0;
    });

    console.log(`RelayKit two device smoke check passed (${laptop.deviceId} and ${phone.deviceId})`);
  } finally {
    for (const device of [...devices, bobDevice]) await device?.client.logout().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit two device smoke check failed: ${error.message}`);
    process.exit(1);
  });
