import assert from "node:assert/strict";
import test from "node:test";
import { Direction, MatrixEvent } from "matrix-js-sdk";
import { listMatrixMessages } from "../packages/matrix-js/dist/matrix-timeline.js";

const roomId = "!room:example.org";

const said = (id, body) =>
  new MatrixEvent({
    type: "m.room.message",
    event_id: id,
    sender: "@bob:example.org",
    room_id: roomId,
    origin_server_ts: 1000,
    content: { msgtype: "m.text", body }
  });

/** A room the sync described without any of its talk, with more of it still on the server. */
function roomWith({ events = [], more = undefined, fetches = [] } = {}) {
  const timeline = {
    getEvents: () => events,
    getPaginationToken: direction => (direction === Direction.Backward ? more : undefined)
  };
  const asked = [];
  const client = {
    getRoom: () => ({ getLiveTimeline: () => timeline }),
    decryptEventIfNeeded: async () => undefined,
    paginateEventTimeline: async (which, options) => {
      asked.push(options);
      events = [...fetches, ...events];
      return false;
    }
  };
  return { client, asked };
}

test("a conversation whose talk the sync did not bring is fetched rather than read as empty", async () => {
  const { client, asked } = roomWith({
    more: "t1",
    fetches: [said("$one", "Corte parcial en la sede norte")]
  });

  const messages = await listMatrixMessages(client, roomId);

  assert.equal(asked.length, 1);
  assert.equal(asked[0].backwards, true);
  assert.deepEqual(
    messages.map(message => message.body),
    ["Corte parcial en la sede norte"]
  );
});

test("a conversation that already has its talk is not asked for again", async () => {
  const { client, asked } = roomWith({ events: [said("$one", "Ya está aquí")], more: "t1" });

  const messages = await listMatrixMessages(client, roomId);

  assert.equal(asked.length, 0);
  assert.equal(messages.length, 1);
});

test("a conversation with nothing before it is not asked for on every look", async () => {
  const { client, asked } = roomWith({ more: undefined });

  assert.deepEqual(await listMatrixMessages(client, roomId), []);
  assert.equal(asked.length, 0);
});
