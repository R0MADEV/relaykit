import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, RelayKitError } from "@relaykit/core";
import { translateMatrixError } from "../packages/matrix-js/dist/matrix-errors.js";
import { MatrixError } from "matrix-js-sdk";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

test("a start that failed says why it failed, not just that it did", async () => {
  const refuses = new (class extends InMemoryAdapter {
    async start() {
      throw new RelayKitError("INVALID_SESSION", "The session is no longer valid, sign in again");
    }
  })();
  const client = new MessagingClient({ adapter: refuses, storage: new InMemoryStorage(), session });

  // Starting is where a session first meets a homeserver, so it is the most likely place to learn that the
  // session is dead or the network is out. Flattening every one of those to ADAPTER_ERROR throws that away.
  await assert.rejects(client.start(), { code: "INVALID_SESSION" });
});

test("a start that failed for a reason nobody named is still one of ours", async () => {
  const breaks = new (class extends InMemoryAdapter {
    async start() {
      throw new TypeError("algo se rompio por dentro");
    }
  })();
  const client = new MessagingClient({ adapter: breaks, storage: new InMemoryStorage(), session });

  const failure = await client.start().then(
    () => undefined,
    error => error
  );

  assert.ok(failure instanceof RelayKitError);
  assert.equal(failure.code, "ADAPTER_ERROR");
  assert.ok(!failure.message.includes("algo se rompio"), "not a sentence for a screen");
  assert.ok(failure.detail?.includes("algo se rompio"), "but findable in a log");
});

test("a client with no backend refuses to start instead of pretending", async () => {
  const client = new MessagingClient({ session });

  // Starting with nothing underneath used to succeed, and then everything answered emptily: a conversation
  // list with nothing in it looks exactly like an account with no conversations.
  await assert.rejects(client.start(), { code: "NOT_CONFIGURED" });
});

test("a client with no backend does not answer as if there were nothing there", async () => {
  const client = new MessagingClient({ session });
  await assert.rejects(client.conversations.list(), RelayKitError);
});

test("something not found is only a conversation when a conversation was what was asked for", async () => {
  const refusal = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404);

  assert.equal(translateMatrixError(refusal).code, "ADAPTER_ERROR");
  assert.equal(translateMatrixError(refusal, "conversation").code, "CONVERSATION_NOT_FOUND");
  assert.equal(translateMatrixError(refusal, "message").code, "MESSAGE_NOT_FOUND");
});
