const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const users = [
  { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" },
  { username: process.env.MATRIX_USER_B ?? "bob", password: process.env.MATRIX_PASSWORD_B ?? "bob-password" }
];

async function request(path, options = {}) {
  const response = await fetch(`${homeserver}${path}`, options);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  await request("/_matrix/client/versions");
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
