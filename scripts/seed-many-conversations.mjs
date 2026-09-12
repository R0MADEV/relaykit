import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Builds an account big enough to hurt, so the cost of catching up can be measured instead of guessed.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const wanted = Number(process.env.SEED_CONVERSATIONS ?? 2000);

process.on("unhandledRejection", error => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("MatrixClient has been stopped") || message.includes("M_UNRECOGNIZED")) return;
  console.error(error);
  process.exit(1);
});

async function main() {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  await client.login({ ...alice, homeserver, deviceName: "RelayKit seeder" });
  await client.start();
  const already = (await client.conversations.list()).length;
  console.log(`the account already has ${already} conversations`);

  const toMake = Math.max(wanted - already, 0);
  const started = performance.now();
  for (let index = 0; index < toMake; index += 1) {
    // Open on purpose: a conversation with nobody in it is refused, and inviting somebody each time would be
    // a different measurement.
    await client.conversations.create({
      participantIds: [],
      title: `Seed ${Date.now()}-${index}`,
      public: true,
      encrypted: false
    });
    if (index % 200 === 199) console.log(`  ${index + 1} of ${toMake} made`);
  }
  console.log(`made ${toMake} more in ${Math.round((performance.now() - started) / 1000)} s`);
  await client.stop();
}

main().then(() => process.exit(0)).catch(error => {
  console.error(`seeding failed: ${error.message}`);
  process.exit(1);
});
