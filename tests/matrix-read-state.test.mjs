import assert from "node:assert/strict";
import test from "node:test";

const { markMatrixRead, listMatrixPending } = await import("../packages/matrix-js/dist/matrix-details.js");

/** Just enough client to see what goes out, which is the whole point of a receipt. */
function fakeClient({ notifications = [] } = {}) {
  const calls = [];
  const fetched = [];
  const event = { id: "$mensaje" };
  return {
    calls,
    fetched,
    fetchRoomEvent: async (roomId, eventId) => {
      fetched.push(eventId);
      return { event_id: eventId, room_id: roomId, type: "m.room.message", content: { body: "hola" } };
    },
    getEventMapper: () => raw => ({ id: raw.event_id }),
    getRoom: () => ({ findEventById: id => (id === "$mensaje" ? event : undefined) }),
    sendReceipt: (event, receiptType) => {
      calls.push({ sent: event.id, receiptType });
      return Promise.resolve({});
    },
    setRoomReadMarkers: (roomId, fullyRead, publicly, privately) => {
      calls.push({ roomId, fullyRead, publicly, privately });
      return Promise.resolve({});
    },
    http: {
      authedRequest: (method, path, params, body) => {
        calls.push({ method, path, params, ...(body ? { body } : {}) });
        return Promise.resolve({ notifications });
      }
    }
  };
}

test("reading out loud tells the others, and quietly does not", async () => {
  const loud = fakeClient();
  const quiet = fakeClient();

  await markMatrixRead(loud, "!sala:localhost", "$mensaje", {});
  await markMatrixRead(quiet, "!sala:localhost", "$mensaje", { private: true });

  assert.equal(loud.calls[0].publicly?.id, "$mensaje", "reading out loud sent no public receipt");
  assert.equal(loud.calls[0].privately, undefined);
  assert.equal(quiet.calls[0].privately?.id, "$mensaje", "reading quietly sent no private receipt");
  assert.equal(quiet.calls[0].publicly, undefined, "reading quietly told the others anyway");
});

test("either way the marker moves, even for a message not held here", async () => {
  const client = fakeClient();

  await markMatrixRead(client, "!sala:localhost", "$algo-de-hace-mucho", { private: true });

  assert.equal(client.calls[0].fullyRead, "$algo-de-hace-mucho");
  assert.equal(client.calls[0].privately, undefined);
});

test("reading inside a thread says which thread, so the conversation is not cleared with it", async () => {
  const client = fakeClient();

  await markMatrixRead(client, "!sala:localhost", "$mensaje", { threadId: "$raiz" });

  // A threaded receipt goes on its own, because the marker is for the whole conversation and this is not.
  assert.deepEqual(client.calls, [{ sent: "$mensaje", receiptType: "m.read" }]);
});

test("reading inside a thread works for a message this device never loaded", async () => {
  const client = fakeClient();

  await markMatrixRead(client, "!sala:localhost", "$de-hace-mucho", { threadId: "$raiz" });

  // Not held here, so it is fetched and then handed to the SDK like any other. Nothing is sent by hand.
  assert.deepEqual(client.fetched, ["$de-hace-mucho"]);
  assert.equal(client.calls[0].sent, "$de-hace-mucho");
  assert.equal(client.calls[0].receiptType, "m.read");
});

test("reading quietly inside a thread is still quiet", async () => {
  const client = fakeClient();

  await markMatrixRead(client, "!sala:localhost", "$mensaje", { threadId: "$raiz", private: true });

  assert.equal(client.calls[0].receiptType, "m.read.private");
});

test("what is waiting is asked of the homeserver, not worked out from what is here", async () => {
  const client = fakeClient({
    notifications: [{
      room_id: "!sala:localhost",
      actions: ["notify", { set_tweak: "highlight", value: true }],
      event: { event_id: "$aviso", sender: "@bob:localhost", content: { body: "te espera esto" } }
    }]
  });

  const waiting = await listMatrixPending(client, 50);

  assert.equal(client.calls[0].path, "/notifications");
  assert.deepEqual(client.calls[0].params, { limit: "50" });
  assert.deepEqual(waiting, [{
    conversationId: "!sala:localhost",
    messageId: "$aviso",
    senderId: "@bob:localhost",
    body: "te espera esto",
    isMention: true
  }]);
});
