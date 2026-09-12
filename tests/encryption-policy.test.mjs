import assert from "node:assert/strict";
import test from "node:test";

const { createMatrixConversation } = await import("../packages/matrix-js/dist/matrix-conversations.js");

/**
 * En Matrix el cifrado solo se puede sumar, nunca restar: quien llama puede forzarlo mandando el evento de
 * estado, pero no puede impedir que el homeserver lo anada por politica. Y una vez puesto en una sala, es para
 * siempre. Asi que la librería pide cuando se lo mandan y se calla cuando no, para que decida el operador.
 */
function fakeClient(asked, { elServidorCifra = false } = {}) {
  const sala = {
    roomId: "!sala:localhost",
    name: "sala",
    tags: {},
    getMyMembership: () => "join",
    getDMInviter: () => undefined,
    getCanonicalAlias: () => null,
    getJoinRule: () => "invite",
    getMembers: () => [],
    getLastLiveEvent: () => undefined,
    getUnreadNotificationCount: () => 0,
    getLiveTimeline: () => ({ getEvents: () => [] }),
    currentState: {
      getStateEvents: type => (type === "m.room.create" ? { getContent: () => ({}) } : null),
      getHistoryVisibility: () => "shared"
    },
    getAccountData: () => undefined,
    hasEncryptionStateEvent: () => false,
    client: { getAccountData: () => undefined }
  };
  return {
    createRoom: async options => {
      asked.push(options);
      return { room_id: "!sala:localhost" };
    },
    getRoom: () => sala,
    getSafeUserId: () => "@alice:localhost",
    // Lo que el servidor acabo poniendo, que es lo que se le pregunta al crear.
    getStateEvent: async () => {
      const loPidio = asked.at(-1)?.initial_state?.some(e => e.type === "m.room.encryption");
      if (loPidio || elServidorCifra) return { algorithm: "m.megolm.v1.aes-sha2" };
      throw new Error("M_NOT_FOUND");
    }
  };
}

function encryptionAskedFor(options) {
  return (options.initial_state ?? []).some(event => event.type === "m.room.encryption");
}

test("sin decir nada, la politica la decide el homeserver", async () => {
  const asked = [];

  await createMatrixConversation(fakeClient(asked), { participantIds: ["@bob:localhost"] });

  assert.equal(encryptionAskedFor(asked[0]), false, "la librería impuso cifrado y piso al homeserver");
});

test("pedirlo expresamente lo cifra, diga lo que diga el homeserver", async () => {
  const asked = [];

  await createMatrixConversation(fakeClient(asked), { participantIds: ["@bob:localhost"], encrypted: true });

  assert.equal(encryptionAskedFor(asked[0]), true);
});

test("no pedirlo tampoco lo impone: el homeserver sigue pudiendo cifrar", async () => {
  const asked = [];

  await createMatrixConversation(fakeClient(asked), { participantIds: ["@bob:localhost"], encrypted: false });

  assert.equal(encryptionAskedFor(asked[0]), false);
});

test("una conversacion directa tampoco impone la politica", async () => {
  const asked = [];
  const client = fakeClient(asked);
  client.setAccountData = async () => undefined;
  client.getAccountData = () => undefined;

  await createMatrixConversation(client, { participantIds: ["@bob:localhost"], direct: true });

  assert.equal(encryptionAskedFor(asked[0]), false);
});

test("si el homeserver cifra por politica, la conversacion lo dice aunque nadie lo pidiera", async () => {
  const asked = [];

  const conversation = await createMatrixConversation(
    fakeClient(asked, { elServidorCifra: true }),
    { participantIds: ["@bob:localhost"] }
  );

  assert.equal(encryptionAskedFor(asked[0]), false, "la librería lo pidio, y no debia");
  assert.equal(conversation.isEncrypted, true, "el servidor cifro y la conversacion no lo cuenta");
});
