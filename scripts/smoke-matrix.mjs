import { registerAccount } from "./fresh-accounts.mjs";
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";

async function request(path, options = {}) {
  const response = await fetch(`${homeserver}${path}`, options);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  await request("/_matrix/client/versions");
  // Accounts made for this run: the point is that the homeserver answers and signing in works, not that any
  // particular person exists. Two of them, because one proves less than two.
  const users = [];
  for (const purpose of ["matrix-a", "matrix-b"]) {
    const account = await registerAccount(purpose, "RelayKit matrix smoke", { start: false });
    users.push(account);
    await account.client.stop().catch(() => undefined);
  }
  for (const user of users) {
    const result = await request("/_matrix/client/v3/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "m.login.password",
        user: user.username,
        password: user.password
      })
    });
    if (!result.user_id || !result.access_token || !result.device_id) {
      throw new Error(`Login response for ${user.username} is incomplete`);
    }
  }
  console.log("Matrix smoke check passed for two users");
}

main().catch(error => {
  console.error(`Matrix smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
