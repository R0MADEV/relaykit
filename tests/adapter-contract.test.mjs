import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { InMemoryAdapter } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

/**
 * One suite that every MessagingAdapter must satisfy. It runs against the in-memory adapter always and
 * against the Matrix adapter when RELAYKIT_CONTRACT_MATRIX=1 and a homeserver is reachable.
 */

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const matrixUser = process.env.MATRIX_USER_A ?? "alice";
const matrixPassword = process.env.MATRIX_PASSWORD_A ?? "alice-password";

async function inMemorySetup() {
  const adapter = new InMemoryAdapter();
  await adapter.start({ homeserver: "memory://test", userId: "alice", accessToken: "token" }, {});
  return { adapter, participant: "bob", cleanup: () => adapter.stop() };
}

async function matrixSetup() {
  const adapter = new MatrixJsAdapter();
  const session = await adapter.login({
    homeserver,
    username: matrixUser,
    password: matrixPassword,
    deviceName: "RelayKit contract"
  });
  await adapter.start(session, {});
  return { adapter, participant: `@${process.env.MATRIX_USER_B ?? "bob"}:localhost`, cleanup: () => adapter.logout() };
}

async function waitFor(description, check, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function runContract(name, setup) {
  describe(`adapter contract: ${name}`, () => {
    let adapter;
    let participant;
    let cleanup;
    let conversationId;

    before(async () => {
      ({ adapter, participant, cleanup } = await setup());
      // Unencrypted so the contract covers adapter behaviour, not the crypto pipeline the smokes already cover.
      const conversation = await adapter.createConversation({
        participantIds: [participant],
        title: "RelayKit contract",
        encrypted: false
      });
      conversationId = conversation.id;
      assert.equal(typeof conversation.id, "string");
      assert.ok(conversation.id.length > 0);
    });

    after(async () => {
      await cleanup?.();
    });

    it("lists the conversation it just created", async () => {
      const conversations = await waitFor("the conversation to be listed", async () => {
        const listed = await adapter.listConversations();
        return listed.find(item => item.id === conversationId);
      });
      assert.equal(conversations.id, conversationId);
    });

    it("sends a message that keeps its transaction id and appears in the timeline", async () => {
      const body = `contract-${Date.now()}`;
      const transactionId = `txn-${Date.now()}`;

      const sent = await adapter.sendMessage(conversationId, body, transactionId);

      assert.equal(sent.body, body);
      assert.equal(sent.status, "sent");
      assert.equal(sent.transactionId, transactionId);
      assert.equal(sent.conversationId, conversationId);
      assert.equal(typeof sent.createdAt, "number");
      const messages = await waitFor("the message to reach the timeline", async () => {
        const listed = await adapter.listMessages(conversationId);
        return listed.find(message => message.id === sent.id);
      });
      assert.equal(messages.body, body);
    });

    it("does not duplicate a message when the same transaction id is sent twice", async () => {
      const body = `idempotent-${Date.now()}`;
      const transactionId = `txn-idempotent-${Date.now()}`;

      const first = await adapter.sendMessage(conversationId, body, transactionId);
      const second = await adapter.sendMessage(conversationId, body, transactionId);

      assert.equal(second.id, first.id);
      const listed = await adapter.listMessages(conversationId);
      assert.equal(listed.filter(message => message.body === body).length, 1);
    });

    it("returns a page with the timeline and whether older history remains", async () => {
      const page = await adapter.loadMoreMessages(conversationId, 10);

      assert.equal(typeof page.hasMore, "boolean");
      assert.ok(Array.isArray(page.messages));
      assert.ok(page.messages.every(message => message.conversationId === conversationId));
    });

    it("uploads an attachment and downloads back the same bytes", async () => {
      const data = new Uint8Array(64).map((_, index) => index * 3 % 256);
      const progress = [];

      const sent = await adapter.sendAttachment(
        conversationId,
        { name: "contract.bin", mimeType: "application/octet-stream", data },
        `txn-file-${Date.now()}`,
        fraction => progress.push(fraction)
      );

      assert.equal(sent.attachment.name, "contract.bin");
      assert.ok(sent.attachment.source.length > 0);
      assert.equal(progress.at(-1), 1);
      assert.deepEqual(await adapter.downloadAttachment(sent.attachment), data);
    });

    it("uploads a thumbnail that can be downloaded on its own", async () => {
      const data = new Uint8Array(64).map((_, index) => index % 251);
      const thumbnailData = new Uint8Array([1, 2, 3, 4, 5, 6]);

      const sent = await adapter.sendAttachment(
        conversationId,
        { name: "foto.jpg", mimeType: "image/jpeg", data, width: 800, height: 600, thumbnail: { mimeType: "image/jpeg", data: thumbnailData, width: 80, height: 60 } },
        `txn-thumb-${Date.now()}`
      );

      const { thumbnail } = sent.attachment;
      assert.equal(thumbnail.mimeType, "image/jpeg");
      assert.equal(thumbnail.width, 80);
      assert.deepEqual(await adapter.downloadAttachment(thumbnail), thumbnailData);
      assert.deepEqual(await adapter.downloadAttachment(sent.attachment), data);
    });

    it("edits and deletes a message", async () => {
      const sent = await adapter.sendMessage(conversationId, `editable-${Date.now()}`, `txn-edit-${Date.now()}`);

      const edited = await adapter.editMessage(conversationId, sent.id, "editado");
      assert.equal(edited.body, "editado");
      assert.equal(typeof edited.editedAt, "number");

      const deleted = await adapter.deleteMessage(conversationId, sent.id);
      assert.equal(deleted.body, "");
      assert.equal(typeof deleted.deletedAt, "number");
    });

    it("resolves a profile for the current user and for an unknown one", async () => {
      const ownUserId = name === "in-memory" ? "alice" : `@${matrixUser}:localhost`;

      const own = await adapter.getProfile(ownUserId);
      const unknown = await adapter.getProfile("@nobody-here-at-all:localhost");

      assert.equal(own.id, ownUserId);
      assert.equal(unknown.id, "@nobody-here-at-all:localhost");
      assert.equal(unknown.displayName, undefined);
      assert.equal(await adapter.getAvatar("@nobody-here-at-all:localhost"), undefined);
    });

    it("sends a reply that points at the message it answers", async () => {
      const original = await adapter.sendMessage(conversationId, `original-${Date.now()}`, `txn-original-${Date.now()}`);

      const reply = await adapter.sendMessage(conversationId, "respuesta", `txn-reply-${Date.now()}`, original.id);

      assert.equal(reply.replyToId, original.id);
      assert.equal(original.replyToId, undefined);
      const listed = await waitFor("the reply to reach the timeline", async () => {
        const messages = await adapter.listMessages(conversationId);
        return messages.find(message => message.id === reply.id);
      });
      assert.equal(listed.replyToId, original.id);
    });

    it("invites, renames and leaves a conversation of its own", async () => {
      const own = await adapter.createConversation({ participantIds: [], title: "RelayKit contract lifecycle", encrypted: false });

      const invited = await adapter.inviteToConversation(own.id, participant);
      assert.ok(invited.participantIds.includes(participant));

      const renamed = await adapter.renameConversation(own.id, "Renombrada");
      assert.equal(renamed.title, "Renombrada");

      await adapter.leaveConversation(own.id);
      const listed = await waitFor("the conversation to disappear", async () => {
        const conversations = await adapter.listConversations();
        return conversations.every(item => item.id !== own.id) ? conversations : undefined;
      });
      assert.ok(listed.every(item => item.id !== own.id));
    });

    it("marks a message as read and can be asked who read it", async () => {
      const sent = await adapter.sendMessage(conversationId, `read-${Date.now()}`, `txn-read-${Date.now()}`);

      await adapter.markMessageRead(conversationId, sent.id);

      const receipts = await adapter.getReadReceipts(conversationId, sent.id);
      assert.ok(Array.isArray(receipts));
      assert.ok(receipts.every(receipt => receipt.messageId === sent.id && typeof receipt.readAt === "number"));
    });
  });
}

runContract("in-memory", inMemorySetup);

if (process.env.RELAYKIT_CONTRACT_MATRIX === "1") {
  runContract("matrix", matrixSetup);
}
