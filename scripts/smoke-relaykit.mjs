import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: "alice", password: "alice-password" };
const bob = { username: "bob", password: "bob-password" };

async function createClient(credentials) {
  const adapter = new MatrixJsAdapter();
  const client = new MessagingClient({ adapter });
  await client.login({ ...credentials, homeserver, deviceName: "RelayKit smoke check" });
  await client.start();
  return client;
}

async function waitFor(description, check, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForMessage(client, conversationId, body) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const messages = await client.messages.list(conversationId);
    const message = messages.find(item => item.body === body);
    if (message) {
      return message;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the decrypted message in the timeline");
}

async function main() {
  const aliceClient = await createClient(alice);
  const bobClient = await createClient(bob);
  try {
    const membershipUpdates = [];
    aliceClient.on("conversation.updated", updated => membershipUpdates.push(updated));
    const conversation = await aliceClient.conversations.create({
      participantIds: ["@bob:localhost"],
      title: "RelayKit smoke check"
    });
    await bobClient.conversations.join(conversation.id);
    await bobClient.messages.list(conversation.id);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const body = `smoke-${Date.now()}`;
    await aliceClient.messages.send(conversation.id, body);
    await waitForMessage(bobClient, conversation.id, body);

    const fileName = `smoke-${Date.now()}.bin`;
    const fileBytes = new Uint8Array(4096).map((_, index) => index % 251);
    const progress = [];
    const thumbnailBytes = new Uint8Array(128).map((_, index) => index % 97);
    const sentFile = await aliceClient.messages.sendFile(
      conversation.id,
      {
        name: fileName,
        mimeType: "application/octet-stream",
        data: fileBytes,
        thumbnail: { mimeType: "image/jpeg", data: thumbnailBytes, width: 64, height: 64 }
      },
      { onProgress: fraction => progress.push(fraction) }
    );
    if (!sentFile.attachment || progress.at(-1) !== 1) {
      throw new Error(`The attachment was not sent with progress: ${JSON.stringify({ attachment: sentFile.attachment, progress })}`);
    }
    const receivedFile = await waitForMessage(bobClient, conversation.id, fileName);
    const receivedThumbnail = receivedFile.attachment.thumbnail;
    if (!receivedThumbnail) {
      throw new Error("The received attachment has no thumbnail");
    }
    const downloadedThumbnail = await bobClient.media.download(receivedThumbnail);
    const isSameThumbnail = downloadedThumbnail.length === thumbnailBytes.length
      && downloadedThumbnail.every((byte, index) => byte === thumbnailBytes[index]);
    if (!isSameThumbnail) {
      throw new Error("The downloaded thumbnail does not match the uploaded bytes");
    }
    const downloaded = await bobClient.media.download(receivedFile.attachment);
    const isSameContent = downloaded.length === fileBytes.length && downloaded.every((byte, index) => byte === fileBytes[index]);
    if (!isSameContent) {
      throw new Error("The downloaded attachment does not match the uploaded bytes");
    }
    const notifications = [];
    aliceClient.on("notification", notification => notifications.push(notification));

    const unreadBody = `unread-${Date.now()}`;
    await bobClient.messages.send(conversation.id, unreadBody);
    const unreadMessage = await waitForMessage(aliceClient, conversation.id, unreadBody);
    const unread = await waitFor("Alice to see the unread message", async () => {
      const listed = await aliceClient.conversations.list();
      const current = listed.find(item => item.id === conversation.id);
      return (current?.unreadCount ?? 0) > 0 ? current : undefined;
    });
    await aliceClient.messages.markRead(conversation.id, unreadMessage.id);
    await waitFor("the unread count to clear once read", async () => {
      const listed = await aliceClient.conversations.list();
      return listed.find(item => item.id === conversation.id)?.unreadCount === 0;
    });

    const notified = notifications.find(notification => notification.body === unreadBody);
    if (!notified || notified.senderId !== "@bob:localhost") {
      throw new Error(`Alice was not notified about Bob's message: ${JSON.stringify(notifications)}`);
    }
    if (notifications.some(notification => notification.senderId === "@alice:localhost")) {
      throw new Error("Alice was notified about her own message");
    }

    const sawBobJoin = membershipUpdates.some(updated => updated.participantIds.includes("@bob:localhost"));
    if (!sawBobJoin) {
      throw new Error("Alice was never told that Bob joined the conversation");
    }

    let page = { hasMore: true, messages: [] };
    let pages = 0;
    while (page.hasMore && pages < 10) {
      page = await bobClient.messages.loadMore(conversation.id, 10);
      pages += 1;
    }
    if (page.hasMore) {
      throw new Error("Pagination never reached the start of the conversation");
    }
    if (!page.messages.some(message => message.body === body)) {
      throw new Error("The paginated timeline does not contain the sent message");
    }

    const readMessage = await aliceClient.messages.send(conversation.id, `read-${Date.now()}`);
    await waitForMessage(bobClient, conversation.id, readMessage.body);
    await bobClient.messages.markRead(conversation.id, readMessage.id);
    const readers = await waitFor("Bob's read receipt to reach Alice", async () => {
      const receipts = await aliceClient.messages.readBy(conversation.id, readMessage.id);
      return receipts.some(receipt => receipt.userId === "@bob:localhost") ? receipts : undefined;
    });
    if (readers.every(receipt => typeof receipt.readAt !== "number")) {
      throw new Error("The read receipts carry no timestamp");
    }

    const direct = await aliceClient.conversations.open("@bob:localhost");
    const directAgain = await aliceClient.conversations.open("@bob:localhost");
    if (!direct.isDirect || direct.id !== directAgain.id) {
      throw new Error(`Opening the direct conversation twice produced different rooms: ${direct.id} vs ${directAgain.id}`);
    }
    console.log(`RelayKit end-to-end smoke check passed (text + encrypted attachment + unread ${unread.unreadCount} + direct conversation + pagination in ${pages} page(s))`);
  } finally {
    await bobClient.logout();
    await aliceClient.logout();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit end-to-end smoke check failed: ${error.message}`);
    process.exit(1);
  });
