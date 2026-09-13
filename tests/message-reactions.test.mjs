import assert from "node:assert/strict";
import test from "node:test";
import { MatrixEvent } from "matrix-js-sdk";
import { mapMessages } from "../packages/matrix-js/dist/matrix-mapper.js";

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

const reacted = (id, to, key, who, at) =>
  new MatrixEvent({
    type: "m.reaction",
    event_id: id,
    sender: who,
    room_id: roomId,
    origin_server_ts: at,
    content: { "m.relates_to": { rel_type: "m.annotation", event_id: to, key } }
  });

test("a message carries the reactions left on it", () => {
  const [message] = mapMessages([
    said("$one", "Rutas reencaminadas al primario."),
    reacted("$r1", "$one", "👍", "@ana:example.org", 1100),
    reacted("$r2", "$one", "🎉", "@carol:example.org", 1200)
  ]);

  assert.deepEqual(message.reactions, [
    { id: "$r1", messageId: "$one", senderId: "@ana:example.org", key: "👍", createdAt: 1100 },
    { id: "$r2", messageId: "$one", senderId: "@carol:example.org", key: "🎉", createdAt: 1200 }
  ]);
});

test("a message nobody reacted to carries no reactions at all", () => {
  const [message] = mapMessages([said("$one", "Nadie dijo nada")]);
  assert.equal("reactions" in message, false);
});
