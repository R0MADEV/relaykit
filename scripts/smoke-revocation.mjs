import { registerAccount, closeWhatWasMade } from "./fresh-accounts.mjs";

// Whoever provisions the accounts can take one away: a suspension, somebody leaving, a token revoked from
// another device. The application has to find out and send that person back to the sign in screen.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";

process.on("unhandledRejection", error => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("MatrixClient has been stopped") || message.includes("M_UNKNOWN_TOKEN")) return;
  console.error(error);
  process.exit(1);
});

async function main() {
  // An account of its own, and not negotiable: this check revokes the token. Doing that to a shared account
  // leaves every later check signed out, with failures that mention nothing of the sort.
  const { client, accessToken } = await registerAccount("revoked", "RelayKit revocation smoke");
  const session = { accessToken };
  await client.conversations.list();

  const toldAbout = new Promise(resolve => client.on("session.ended", () => resolve(true)));
  const gaveUpWaiting = new Promise(resolve => setTimeout(() => resolve(false), 60000));

  // What whoever runs the accounts does when they suspend somebody: revoke the token from outside.
  const revoked = await fetch(`${homeserver}/_matrix/client/v3/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!revoked.ok) throw new Error(`Revoking the session answered ${revoked.status}`);

  // Something has to touch the homeserver for the refusal to arrive; an open application does so on sync.
  const nudging = setInterval(() => void client.conversations.list().catch(() => undefined), 2000);
  const wasTold = await Promise.race([toldAbout, gaveUpWaiting]);
  clearInterval(nudging);
  if (!wasTold) throw new Error("The session was revoked and nobody was told");

  // And what is left has to be an honestly stopped client, not one that is half running.
  const afterwards = await client.conversations.list().catch(error => error);
  if (!(afterwards instanceof Error)) throw new Error("A revoked session still answers as if it worked");

  console.log(`RelayKit revocation smoke check passed (told, and left stopped: ${afterwards.code})`);
}

main()
  .finally(closeWhatWasMade)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit revocation smoke check failed: ${error.message}`);
    process.exit(1);
  });
