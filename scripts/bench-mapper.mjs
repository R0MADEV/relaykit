import { MatrixEvent } from "matrix-js-sdk";
import { mapConversation } from "../packages/matrix-js/dist/matrix-mapper.js";

// What it costs to turn one room into a conversation. The conversation list does this for every room.
const members = Number(process.env.BENCH_MEMBERS ?? 800);
const timeline = Number(process.env.BENCH_TIMELINE ?? 200);
const rooms = Number(process.env.BENCH_ROOMS ?? 60);
const roomId = "!bench:example.org";

function fakeRoom() {
  const people = Array.from({ length: members }, (_, index) => ({
    userId: `@person-${index}:example.org`,
    membership: index % 20 === 0 ? "invite" : "join"
  }));
  const events = Array.from({ length: timeline }, (_, index) => new MatrixEvent({
    type: "m.room.message",
    event_id: `$event-${index}`,
    sender: `@person-${index % members}:example.org`,
    room_id: roomId,
    origin_server_ts: 1700000000000 + index,
    content: { msgtype: "m.text", body: `mensaje ${index} con algo de texto` }
  }));
  return {
    roomId,
    name: "Sala grande",
    getLiveTimeline: () => ({ getEvents: () => events }),
    getMembers: () => people,
    getMyMembership: () => "join",
    getUnreadNotificationCount: () => 0,
    getDMInviter: () => undefined,
    getAccountData: () => undefined,
    currentState: { getStateEvents: () => null },
    client: { getAccountData: () => undefined, pushRules: undefined }
  };
}

const room = fakeRoom();
mapConversation(room);

const started = performance.now();
for (let index = 0; index < rooms; index += 1) mapConversation(room);
const took = performance.now() - started;

console.log(`${rooms} rooms of ${members} people and ${timeline} events`);
console.log(`mapping the conversation list        ${took.toFixed(1).padStart(8)} ms`);
console.log(`per room                             ${(took / rooms).toFixed(2).padStart(8)} ms`);
