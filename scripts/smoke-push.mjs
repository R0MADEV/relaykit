import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Registrar un gateway y que el homeserver le entregue algo no son lo mismo. Aqui hay un gateway de verdad,
// dentro de la red de Docker, que apunta lo que recibe. Se comprueba que llega lo que tiene que llegar y que
// NO llega lo que no debe: con `event_id_only`, lo dicho se queda entre los dispositivos.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const bob = { username: process.env.MATRIX_USER_B ?? "bob", password: process.env.MATRIX_PASSWORD_B ?? "bob-password" };
// El homeserver lo alcanza por nombre dentro de la red; esta comprobacion lo lee por el puerto publicado.
const gatewayFromHomeserver = process.env.PUSH_GATEWAY_URL ?? "http://push-gateway:8080/_matrix/push/v1/notify";
const gatewayFromHere = process.env.PUSH_GATEWAY_INSPECT ?? "http://localhost:8090/received";

process.on("unhandledRejection", error => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("MatrixClient has been stopped")) return;
  console.error(error);
  process.exit(1);
});

async function whatTheGatewayReceived() {
  const response = await fetch(gatewayFromHere);
  if (!response.ok) throw new Error(`The gateway answered ${response.status}`);
  return response.json();
}

async function createClient(credentials, deviceName) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  const session = await client.login({ ...credentials, homeserver, deviceName });
  await client.start();
  return { client, userId: session.userId };
}

async function waitFor(description, check, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  let aliceSide;
  let bobSide;
  try {
    await fetch(gatewayFromHere, { method: "DELETE" }).catch(() => undefined);
    aliceSide = await createClient(alice, "RelayKit push smoke (alice)");
    bobSide = await createClient(bob, "RelayKit push smoke (bob)");

    await aliceSide.client.push.register({
      gatewayUrl: gatewayFromHomeserver,
      deviceToken: `relaykit-push-${Date.now()}`,
      appId: "com.relaykit.smoke",
      appName: "RelayKit"
    });
    const registered = await aliceSide.client.push.registered();
    if (!registered.some(item => item.gatewayUrl === gatewayFromHomeserver)) {
      throw new Error(`The homeserver does not list the gateway: ${JSON.stringify(registered)}`);
    }

    const conversation = await bobSide.client.conversations.open(aliceSide.userId);
    await waitFor("Alice to be invited", async () => {
      const conversations = await aliceSide.client.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await aliceSide.client.conversations.join(conversation.id);

    const secret = `no-debe-salir-${Date.now()}`;
    const sent = await bobSide.client.messages.send(conversation.id, secret);

    const everything = await waitFor("the homeserver to notify the gateway", async () => {
      const notifications = await whatTheGatewayReceived();
      return notifications.some(item => item?.event_id === sent.id) ? notifications : undefined;
    });
    const arrived = everything.find(item => item.event_id === sent.id);

    if (arrived.room_id !== conversation.id) {
      throw new Error(`The notification names another conversation: ${arrived.room_id}`);
    }
    // Lo que se dijo se queda entre los dispositivos: el gateway sabe que hay algo, no que dice.
    if (JSON.stringify(everything).includes(secret)) {
      throw new Error("The message reached the gateway, so what is said does not stay between the devices");
    }

    console.log(`RelayKit push smoke check passed (${everything.length} notified, and what was said never left)`);
  } finally {
    for (const side of [aliceSide, bobSide]) await side?.client.logout().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit push smoke check failed: ${error.message}`);
    process.exit(1);
  });
