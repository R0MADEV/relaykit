import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Quien provisiona las cuentas puede quitarlas: una suspension, una baja, un token revocado desde otro sitio.
// La aplicacion tiene que enterarse y mandar a esa persona a la pantalla de entrada.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };

process.on("unhandledRejection", error => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("MatrixClient has been stopped") || message.includes("M_UNKNOWN_TOKEN")) return;
  console.error(error);
  process.exit(1);
});

async function main() {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  const session = await client.login({ ...alice, homeserver, deviceName: "RelayKit revocation smoke" });
  await client.start();
  await client.conversations.list();

  const toldAbout = new Promise(resolve => client.on("session.ended", () => resolve(true)));
  const gaveUpWaiting = new Promise(resolve => setTimeout(() => resolve(false), 60000));

  // Lo que hace quien administra las cuentas cuando suspende a alguien: revocar el token desde fuera.
  const revoked = await fetch(`${homeserver}/_matrix/client/v3/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!revoked.ok) throw new Error(`Revoking the session answered ${revoked.status}`);

  // Algo tiene que tocar al homeserver para que la negativa llegue; una aplicacion abierta lo hace al sincronizar.
  const nudging = setInterval(() => void client.conversations.list().catch(() => undefined), 2000);
  const wasTold = await Promise.race([toldAbout, gaveUpWaiting]);
  clearInterval(nudging);
  if (!wasTold) throw new Error("The session was revoked and nobody was told");

  // Y lo que queda tiene que ser un cliente honestamente parado, no uno a medias.
  const afterwards = await client.conversations.list().catch(error => error);
  if (!(afterwards instanceof Error)) throw new Error("A revoked session still answers as if it worked");

  console.log(`RelayKit revocation smoke check passed (told, and left stopped: ${afterwards.code})`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit revocation smoke check failed: ${error.message}`);
    process.exit(1);
  });
