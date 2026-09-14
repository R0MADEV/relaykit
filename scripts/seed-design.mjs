import { createRequire } from "node:module";
import { MessagingClient } from "@relaykit/core";

const require = createRequire(import.meta.url);
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// One conversation with everything a screen can draw in it: talk from three people, a thread, reactions, an
// invitation to a room, and something left unread. The application has screens that only appear when the data
// is there — a thread panel needs a thread — and an account full of test debris has none of it.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const named = process.env.SEED_TITLE ?? "incidencias-voz";

process.on("unhandledRejection", error => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("MatrixClient has been stopped") || message.includes("M_UNRECOGNIZED")) return;
  console.error(error);
  process.exit(1);
});

async function signIn(username) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  await client.login({
    homeserver,
    username,
    password: `${username}-password`,
    deviceName: "RelayKit seeder"
  });
  await client.start({ waitForSync: true });
  return client;
}

/** Said by whoever said it, so the timeline has more than one voice in it. */
async function say(who, where, body, options) {
  const message = await who.messages.send(where, body, options ?? {});
  // Matrix orders by the server's clock, and three clients talking at once arrive in whatever order they land.
  await new Promise(resolve => setTimeout(resolve, 150));
  return message;
}

async function main() {
  const [alice, bob, carol] = await Promise.all([signIn("alice"), signIn("bob"), signIn("carol")]);

  // Unencrypted on purpose: this is here to be looked at, and a device that was not in the room when it was
  // said has no key for it. What encryption does is checked by the smoke tests, not by a screenshot.
  const channel = await alice.conversations.create({
    participantIds: ["@bob:localhost", "@carol:localhost"],
    title: named,
    public: true,
    encrypted: false
  });
  await alice.conversations.setTopic(channel.id, "Guardias y cortes de servicio");
  await Promise.all([bob.conversations.join(channel.id), carol.conversations.join(channel.id)]);
  console.log(`made #${named} at ${channel.id}`);

  const opened = await say(
    bob,
    channel.id,
    "Corte parcial en la sede norte: el SBC secundario no registra. Abro incidencia."
  );
  await say(bob, channel.id, "Confirmado, afecta a 40 extensiones del edificio Amigos.");
  const asked = await say(
    carol,
    channel.id,
    "¿Aviso a Secretaría o lo gestionáis vosotros? Tengo tres llamadas en cola."
  );
  await say(alice, channel.id, "Rutas reencaminadas al primario. 240 ms p95 estables.");

  // A thread, which is a screen of its own and the only thing that opens it.
  const thread = { threadId: asked.id };
  await say(bob, channel.id, "Lo gestionamos nosotros, pero avisa tú a Secretaría: es su edificio.", thread);
  await say(carol, channel.id, "Hecho. Les digo que desvíen al 2551 mientras dure el corte.", thread);
  await say(alice, channel.id, "Desvío aplicado en la centralita, sin pérdida de llamadas.", thread);
  await say(carol, channel.id, "Perfecto, ya no entran quejas en el mostrador.", thread);
  await say(bob, channel.id, "Cierro el aviso cuando el secundario vuelva a registrar.", thread);
  console.log(`hung 5 answers off ${asked.id}`);

  for (const [who, message, key] of [
    [alice, opened, "👀"],
    [carol, opened, "👀"],
    [bob, opened, "👍"]
  ]) {
    await who.reactions.add(channel.id, message.id, key);
  }
  console.log("left reactions on the first message");

  // A picture, so a screen has something to draw as itself rather than as a file name.
  await alice.messages.sendFile(channel.id, {
    name: "grafica-latencia.png",
    mimeType: "image/png",
    data: aPicture()
  });
  console.log("sent a picture");

  // An invitation: the link is what a message carries, and any client that understands matrix.to opens it.
  const link = await alice.conversations.link(channel.id);
  await say(bob, channel.id, link);
  console.log(`sent the way in: ${link}`);

  // Something said after this account last read, so the list has an unread count on it.
  await say(carol, channel.id, "Me uno en cinco, termino una llamada.");
  await alice.conversations.setUnread(channel.id, true);

  console.log(`done. sign in as alice and open #${named}`);
  await Promise.all([alice.stop(), bob.stop(), carol.stop()]);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

/**
 * A picture made here rather than kept in the repository: a checked-in binary is a checked-in binary, and
 * what this needs is something that is really a PNG, not something that looks like one.
 */
function aPicture() {
  const wide = 160;
  const tall = 90;
  const rows = [];
  for (let y = 0; y < tall; y += 1) {
    const row = [0];
    for (let x = 0; x < wide; x += 1) {
      const hill = Math.sin(x / 12) * 20 + 45;
      const under = y > hill;
      row.push(under ? 232 : 250, under ? 133 : 250, under ? 60 : 252);
    }
    rows.push(Buffer.from(row));
  }
  return new Uint8Array(png(wide, tall, Buffer.concat(rows)));
}

function png(wide, tall, pixels) {
  const { deflateSync, crc32 } = require("node:zlib");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(wide, 0);
  header.writeUInt32BE(tall, 4);
  header[8] = 8;
  header[9] = 2;
  const chunk = (name, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const named = Buffer.concat([Buffer.from(name), body]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(named));
    return Buffer.concat([length, named, check]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
