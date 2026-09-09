import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";

const distDir = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml"
};

/** The renderer is served over http so it gets a real origin, which IndexedDB requires. */
function serveRenderer() {
  const server = createServer(async (request, response) => {
    const requested = new URL(request.url ?? "/", "http://localhost").pathname;
    const filePath = join(distDir, normalize(requested === "/" ? "/index.html" : requested));
    if (!filePath.startsWith(distDir)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const file = await readFile(filePath);
      response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
      response.end(file);
    } catch {
      response.writeHead(404).end();
    }
  });
  // A fixed port keeps the origin stable, and with it the IndexedDB data between runs.
  return new Promise(resolve => server.listen(41780, "127.0.0.1", () => resolve(server)));
}

/**
 * The key that encrypts the local store must be stable for the device and must not be the access token,
 * which rotates. It is generated once and kept in the operating system keychain through safeStorage.
 */
async function deviceStorageSecret() {
  const secretFile = join(app.getPath("userData"), "relaykit-device-secret");
  const canEncrypt = safeStorage.isEncryptionAvailable();
  try {
    const stored = await readFile(secretFile);
    return canEncrypt ? safeStorage.decryptString(stored) : stored.toString("utf8");
  } catch {
    const secret = randomBytes(32).toString("base64");
    const payload = canEncrypt ? safeStorage.encryptString(secret) : Buffer.from(secret, "utf8");
    await writeFile(secretFile, payload, { mode: 0o600 });
    return secret;
  }
}

function readResult(message) {
  const prefix = "RELAYKIT_RESULT ";
  return message.startsWith(prefix) ? JSON.parse(message.slice(prefix.length)) : undefined;
}

async function main() {
  const server = await serveRenderer();
  ipcMain.handle("relaykit:storage-secret", () => deviceStorageSecret());
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(fileURLToPath(new URL(".", import.meta.url)), "preload.cjs")
    }
  });
  let finished = false;

  const finish = result => {
    if (finished) return;
    finished = true;
    const prefix = result.ok ? "RelayKit Electron check passed" : "RelayKit Electron check failed";
    console.log(`${prefix}: ${result.summary}`);
    if (result.detail) console.log(JSON.stringify(result.detail, undefined, 1));
    server.close();
    app.exit(result.ok ? 0 : 1);
  };

  window.webContents.on("console-message", (...args) => {
    const message = typeof args[1] === "string" ? args[1] : args[0]?.message ?? "";
    const result = readResult(message);
    if (result) finish(result);
    else if (process.env.RELAYKIT_TRACE) console.error(`[renderer] ${message}`);
  });

  setTimeout(() => finish({ ok: false, summary: "the renderer did not report a result in time" }), 120000);
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
}

app.whenReady().then(main);
