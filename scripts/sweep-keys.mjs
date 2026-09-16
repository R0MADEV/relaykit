// Throws away the key backups the checks left on the development accounts.
//
// `check:keys` presses "Proteger mis mensajes" every time it runs: the homeserver keeps a new backup of the
// room keys, the recovery key that opens it is shown once, and the check throws it away. Alice reached version
// twenty-nine that way. What is left is an account whose every new browser says "there is a copy of your keys
// this device has not opened" and offers to take a key that nobody on earth has.
//
// Deleting the backup is not enough on its own: an account with secret storage still set up reads as locked
// rather than as never protected, so what the backup was encrypted under goes too. What survives is what each
// device already holds locally, which is what it can read today.
//
// Not a thing to run against an account anybody depends on: the keys in a backup are the only copy of what an
// empty device could still have read.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const accounts = (process.env.RELAYKIT_SWEEP_USERS ?? "alice,bob,carol").split(",");

async function ask(token, path, method = "GET", body) {
  const response = await fetch(`${homeserver}/_matrix/client/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const said = await response.json().catch(() => ({}));
  return { ok: response.ok, said };
}

async function signIn(username) {
  const response = await fetch(`${homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: username },
      password: `${username}-password`,
      initial_device_display_name: "RelayKit key sweep"
    })
  });
  const said = await response.json();
  if (!said.access_token) throw new Error(said.errcode ?? "could not sign in");
  return said;
}

/**
 * Every version, not only the one in force. A homeserver keeps the older ones, and an account that has been
 * through twenty-nine of them has twenty-nine to answer for.
 */
async function dropEveryBackup(token) {
  let dropped = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { ok, said } = await ask(token, "/room_keys/version");
    if (!ok || !said.version) return dropped;
    const gone = await ask(token, `/room_keys/version/${said.version}`, "DELETE");
    if (!gone.ok) return dropped;
    dropped += 1;
  }
  return dropped;
}

/** What the backup was encrypted under. Account data cannot be deleted in Matrix, so it is emptied. */
async function dropSecretStorage(token, userId) {
  const where = type => `/user/${encodeURIComponent(userId)}/account_data/${type}`;
  const { said: def } = await ask(token, where("m.secret_storage.default_key"));
  const emptied = [];
  for (const type of [
    ...(typeof def.key === "string" ? [`m.secret_storage.key.${def.key}`] : []),
    "m.secret_storage.default_key",
    "m.megolm_backup.v1",
    "m.cross_signing.master",
    "m.cross_signing.self_signing",
    "m.cross_signing.user_signing"
  ]) {
    const { ok } = await ask(token, where(type), "PUT", {});
    if (ok) emptied.push(type);
  }
  return emptied;
}

for (const username of accounts) {
  const done = await (async () => {
    const session = await signIn(username);
    const before = await ask(session.access_token, "/room_keys/version");
    const dropped = await dropEveryBackup(session.access_token);
    const emptied = await dropSecretStorage(session.access_token, session.user_id);
    const after = await ask(session.access_token, "/room_keys/version");
    await ask(session.access_token, "/logout", "POST", {});
    return {
      username,
      wasAtVersion: before.said.version ?? null,
      keysInIt: before.said.count ?? 0,
      backupsDropped: dropped,
      secretsEmptied: emptied.length,
      leftWithABackup: Boolean(after.said.version)
    };
  })().catch(error => ({ username, failed: error.message ?? String(error) }));
  console.log(`RELAYKIT_SWEEP_KEYS ${JSON.stringify(done)}`);
}
process.exit(0);
