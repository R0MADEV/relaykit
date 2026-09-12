"use strict";
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");

// Drives the example in a real browser, which is the one thing the tests cannot reach: the interface itself.
//
// Served over https, no sobre http en localhost. El navegador trata localhost como origen seguro por
// excepcion, asi que probar ahi no prueba lo que vera un usuario: sin origen seguro no existe
// `crypto.subtle`, y sin eso el almacen cifrado no arranca. Un certificado propio basta para que el
// contexto sea seguro de verdad, que es lo que hay que ejercitar.
const root = path.join(__dirname, "..", "examples", "web", "dist");
const detail = {};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };

/** Un certificado para esta comprobacion y nada mas. Se hace al vuelo y se tira al acabar. */
function makeCertificate() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "relaykit-tls-"));
  const key = path.join(folder, "tls.key");
  const certificate = path.join(folder, "tls.crt");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", certificate,
    "-days", "1", "-nodes", "-subj", "/CN=localhost"
  ], { stdio: "ignore" });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(certificate), folder };
}

function serve() {
  const identity = makeCertificate();
  return new Promise(resolve => {
    const server = https.createServer({ key: identity.key, cert: identity.cert }, (request, response) => {
      const asked = new URL(request.url, "http://localhost").pathname;
      const file = path.join(root, asked === "/" ? "index.html" : asked);
      if (!file.startsWith(root) || !fs.existsSync(file)) {
        response.writeHead(404).end("not here");
        return;
      }
      response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(response);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function report(ok, summary) {
  console.log(`RELAYKIT_WEB_RESULT ${JSON.stringify({ ok, summary, detail })}`);
  app.exit(ok ? 0 : 1);
}

async function waitFor(page, description, expression, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await page.webContents.executeJavaScript(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function run() {
  const page = new BrowserWindow({ show: false, width: 1200, height: 900 });
  const problems = [];
  // Complaints while the network is deliberately cut are the right behaviour, not a fault, so they are kept
  // apart rather than ignored: they are reported, they just do not fail the check.
  // Two things, on purpose: what the filter refuses, and what counts as an expected complaint. A request
  // refused during the cut can report its failure a moment after the network is back.
  const state = { networkIsCut: false, expectComplaints: false };
  const complaintsWhileCut = [];
  const recoveredFrom = [];
  page.webContents.on("console-message", (_event, level, message) => {
    if (process.env.RELAYKIT_TRACE) console.error(`[page ${level}] ${message}`);
    if (level < 3) return;
    // A conversation whose state has not caught up cannot lock a message yet, and there is no way to know that
    // beforehand: it looks the same as one that is not encrypted. The send is retried and goes out, but the sdk
    // has already written its own complaint by then. Counted apart rather than ignored.
    const recovered = message.includes("unconfigured room");
    if (recovered) {
      recoveredFrom.push(message);
      return;
    }
    (state.expectComplaints ? complaintsWhileCut : problems).push(message);
  });
  page.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[page] could not load: ${code} ${description}`);
  });
  page.webContents.on("render-process-gone", (_event, details) => {
    report(false, `the page died: ${details.reason} (${details.exitCode})`);
  });
  const server = await serve();
  // El certificado es propio, asi que hay que aceptarlo: lo que se prueba es el contexto seguro, no quien
  // lo firma. Solo para este servidor y esta comprobacion.
  page.webContents.session.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === "127.0.0.1" ? 0 : -3);
  });
  await page.loadURL(`https://127.0.0.1:${server.address().port}/`);

  await waitFor(page, "the sign in form", `document.getElementById("login-form") !== null`);
  detail.signInFormIsThere = true;

  await page.webContents.executeJavaScript(`
    document.getElementById("username").value = "alice";
    document.getElementById("password").value = "alice-password";
    document.getElementById("login-form").requestSubmit();
    true;
  `);

  await waitFor(page, "the application to appear", `document.getElementById("app").hidden === false`, 20)
    .catch(async error => {
      const status = await page.webContents.executeJavaScript(`document.getElementById("status")?.textContent ?? "no status"`);
      throw new Error(`${error.message}. The screen says: ${status}`);
    });
  detail.signedIn = true;

  // Opening a conversation with Bob, which is what the picker is for.
  await page.webContents.executeJavaScript(`
    document.getElementById("participant").value = "@bob:localhost";
    document.getElementById("open-form").requestSubmit();
    true;
  `);
  // Lo que el navegador concede solo en un origen seguro, y de lo que depende el almacen cifrado. Se
  // comprueba a proposito: si alguien devuelve esta comprobacion a http, el fallo tiene que decir esto y no
  // aparecer mas tarde disfrazado de otra cosa.
  detail.secureContext = await page.webContents.executeJavaScript(
    `window.isSecureContext === true && typeof crypto.subtle === "object"`
  );
  if (!detail.secureContext) {
    throw new Error("La pagina no esta en un origen seguro, asi que no hay almacen cifrado que probar");
  }

  await waitFor(page, "a conversation to be listed", `document.querySelectorAll("#conversations li").length > 0`);
  detail.conversationsListed = await page.webContents.executeJavaScript(
    `document.querySelectorAll("#conversations li").length`
  );

  await waitFor(page, "the message box", `document.getElementById("message") !== null && !document.querySelector("footer").hidden`);
  const said = `demo-${Date.now()}`;
  await page.webContents.executeJavaScript(`
    document.getElementById("message").value = ${JSON.stringify(said)};
    document.getElementById("message-form").requestSubmit();
    true;
  `);
  await waitFor(page, "the message to appear in the conversation", `
    [...document.querySelectorAll("#timeline .message")].some(item => item.textContent.includes(${JSON.stringify(said)}))
  `);
  detail.messageOnScreen = true;

  // Lo que la librería sabe hacer tiene que verse. Una funcionalidad que solo se puede comprobar leyendo un
  // log no esta demostrada para quien la va a usar.
  await page.webContents.executeJavaScript(`document.getElementById("sticker").click(); true;`);
  await waitFor(page, "la pegatina pintada sola, sin caja ni boton", `
    [...document.querySelectorAll("#timeline .message.sticker img")].length > 0
  `);
  detail.stickerPainted = true;

  // Una encuesta: preguntarla, verla con sus respuestas, votar y que el recuento suba.
  await page.webContents.executeJavaScript(`
    document.getElementById("poll").click();
    document.getElementById("poll-question").value = "¿A que hora comemos?";
    document.getElementById("poll-form").requestSubmit();
    true;
  `);
  await waitFor(page, "la encuesta en pantalla", `
    [...document.querySelectorAll("#timeline .poll")].some(item => item.textContent.includes("A las 14"))
  `).catch(async error => {
    const why = await page.webContents.executeJavaScript(`
      JSON.stringify({
        estado: document.getElementById("status").textContent,
        encuestas: document.querySelectorAll("#timeline .poll").length,
        formulario: document.getElementById("poll-form").hidden
      })
    `);
    throw new Error(`${error.message} | ${why}`);
  });
  await page.webContents.executeJavaScript(`
    [...document.querySelectorAll("#timeline .poll .answer button")]
      .find(item => item.textContent.includes("A las 15")).click();
    true;
  `);
  await waitFor(page, "el voto contado en pantalla", `
    [...document.querySelectorAll("#timeline .poll .answer")].some(item => /A las 15 · 1/.test(item.textContent))
  `);
  detail.pollVotedOnScreen = true;

  // Un enlace escrito en la caja se mira antes de mandarlo.
  await page.webContents.executeJavaScript(`
    const box = document.getElementById("message");
    box.value = "mira esto http://push-gateway:8080/received";
    box.dispatchEvent(new Event("input"));
    true;
  `);
  detail.linkWasLookedAt = await waitFor(page, "la vista previa del enlace", `
    document.getElementById("link-preview") !== null
  `).then(() => true);

  // Opening it again should not ask who you are, and should not leave you looking at nothing while it asks
  // the homeserver. That is the whole point of remembering the session and painting what is already here.
  const reloadedAt = Date.now();
  await page.reload();
  await waitFor(page, "the application to come back without signing in again", `
    document.getElementById("app") !== null && document.getElementById("app").hidden === false
  `, 40);
  await waitFor(page, "the conversations to be there again", `document.querySelectorAll("#conversations li").length > 0`, 40);
  detail.millisecondsToOpenAgain = Date.now() - reloadedAt;
  detail.cameBackWithoutSigningIn = true;

  // And what it hides itself is not holding a connection open. Reported step by step, because a page that dies
  // here says more about where than about what.
  if (process.env.RELAYKIT_CHECK_HIDING) {
    await page.webContents.executeJavaScript(`
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      true;
    `);
    await waitFor(page, "the connection to be let go", `document.getElementById("status").textContent === "disconnected"`, 40);
    await page.webContents.executeJavaScript(`
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      true;
    `);
    await waitFor(page, "the conversations after coming back", `document.querySelectorAll("#conversations li").length > 0`, 40);
    detail.letGoAndCameBack = true;
  }

  // Reopening leaves nothing chosen. The conversation with Bob is opened by name rather than by picking the
  // first one on the list: everything after this needs a conversation Bob is actually in.
  await page.webContents.executeJavaScript(`
    document.getElementById("participant").value = "@bob:localhost";
    document.getElementById("open-form").requestSubmit();
    true;
  `);
  await waitFor(page, "the conversation with Bob to open", `document.querySelector("footer") !== null && !document.querySelector("footer").hidden`);
  // Reopening paints from what was kept before the homeserver has answered, which is the point. Saying anything
  // in a conversation whose state has not arrived yet is refused and queued, so the check waits for it.
  await waitFor(page, "the client to have caught up", `document.getElementById("status").textContent === "connected"`, 120);

  // A real network cut, which is the one thing the smokes cannot do: the browser is put offline for real.
  // Every request to the homeserver is refused. Electron's offline emulation leaves loopback traffic alone, so
  // it would not cut anything here; refusing the requests is a real cut as far as the application can tell.
  state.networkIsCut = true;
  state.expectComplaints = true;
  page.webContents.session.webRequest.onBeforeRequest({ urls: ["http://localhost/*"] }, (details, callback) => {
    callback({ cancel: state.networkIsCut && details.url.includes(":8008/") });
  });
  await waitFor(page, "requests to start failing", `
    fetch("http://localhost:8008/_matrix/client/versions", { cache: "no-store" }).then(() => false, () => true)
  `, 40);
  const whileOffline = `sin-red-${Date.now()}`;
  await page.webContents.executeJavaScript(`
    document.getElementById("message").value = ${JSON.stringify(whileOffline)};
    document.getElementById("message-form").requestSubmit();
    true;
  `);
  await waitFor(page, "the message to be waiting on screen", `
    [...document.querySelectorAll("#timeline .message")].some(item =>
      item.textContent.includes(${JSON.stringify(whileOffline)}) && !item.textContent.includes("· sent"))
  `, 30).catch(async error => {
    const shown = await page.webContents.executeJavaScript(`
      [...document.querySelectorAll("#timeline .message")].slice(-3).map(item => item.textContent).join(" | ")
    `);
    throw new Error(`${error.message}. The last messages say: ${shown}`);
  });
  detail.waitedWhileOffline = true;

  state.networkIsCut = false;
  await waitFor(page, "requests to work again", `
    fetch("http://localhost:8008/_matrix/client/versions", { cache: "no-store" }).then(() => true, () => false)
  `, 40);
  await waitFor(page, "the message to go out once the network is back", `
    [...document.querySelectorAll("#timeline .message")].some(item =>
      item.textContent.includes(${JSON.stringify(whileOffline)}) && item.textContent.includes("· sent"))
  `, 120);
  detail.wentOutWhenTheNetworkCameBack = true;
  // Complaints stop being expected when the client is demonstrably back, not after a guessed number of
  // seconds: the sync waits longer and longer between attempts, so a clock is the wrong thing to trust.
  await waitFor(page, "the client to be connected again", `
    document.getElementById("status").textContent === "connected"
  `, 120);
  await new Promise(resolve => setTimeout(resolve, 1000));
  state.expectComplaints = false;

  // Something arriving from somebody else while the screen is open, which is what a chat is for. Said from
  // outside the browser, into the very conversation this screen is looking at.
  const watching = await page.webContents.executeJavaScript(
    `document.getElementById("timeline").dataset.conversation`
  );
  if (!watching) throw new Error("The screen does not say which conversation it is looking at");
  const fromBob = `de-bob-${Date.now()}`;
  await new Promise((resolve, reject) => {
    const sender = spawn("node", [path.join(__dirname, "send-as.mjs"), "bob", watching, fromBob]);
    let why = "";
    sender.stderr.on("data", chunk => { why += String(chunk); });
    sender.on("exit", code => {
      if (code === 0) return resolve();
      const said = why.split("\n").filter(line => line.startsWith("could not say it")).join(" ");
      reject(new Error(`Bob could not say it in ${watching}: ${said || `exit ${code}`}`));
    });
  });
  await waitFor(page, "what Bob said to reach the screen", `
    [...document.querySelectorAll("#timeline .message")].some(item => item.textContent.includes(${JSON.stringify(fromBob)}))
  `, 120);
  detail.arrivedWhileWatching = true;

  // Sending a file through the form, which is the heaviest thing a chat does: it is encrypted, uploaded,
  // fetched back and decrypted. A file input cannot be filled from script, so the browser is told to do it.
  const attachment = path.join(root, "..", "..", "..", "package.json");
  page.webContents.debugger.attach("1.3");
  const { root: document } = await page.webContents.debugger.sendCommand("DOM.getDocument");
  const { nodeId } = await page.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: document.nodeId,
    selector: "#file"
  });
  await page.webContents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: [attachment] });
  page.webContents.debugger.detach();
  await page.webContents.executeJavaScript(`document.getElementById("file-form").requestSubmit(); true;`);
  await waitFor(page, "the file to be in the conversation", `
    [...document.querySelectorAll("#timeline .message")].some(item => item.textContent.includes("package.json"))
  `, 120);
  detail.fileWentOut = true;

  // And fetched back: the button is there because the file can be downloaded again.
  await waitFor(page, "the file to be offered for download", `
    [...document.querySelectorAll("#timeline .message")].some(item =>
      item.textContent.includes("package.json") && item.textContent.includes("Descargar"))
  `, 60);
  detail.fileCanBeFetchedBack = true;

  // Looking further back, which is what somebody does when they scroll up through a conversation.
  const shownBefore = await page.webContents.executeJavaScript(
    `document.querySelectorAll("#timeline .message").length`
  );
  const lookedBackAt = Date.now();
  await page.webContents.executeJavaScript(`document.getElementById("load-more").click(); true;`);
  await waitFor(page, "older messages to appear", `
    document.querySelectorAll("#timeline .message").length >= ${shownBefore}
  `, 60);
  detail.millisecondsToLookFurtherBack = Date.now() - lookedBackAt;
  detail.lookedFurtherBack = true;

  // A screen that is used for a while should not keep growing. Measured in the browser, where the storage, the
  // encryption and the page itself all live.
  const heldAtFirst = await page.webContents.executeJavaScript(`performance.memory?.usedJSHeapSize ?? 0`);
  const rounds = Number(process.env.RELAYKIT_MEMORY_ROUNDS ?? 3);
  for (let round = 0; round < rounds; round += 1) {
    await page.webContents.executeJavaScript(`
      (async () => {
        const items = [...document.querySelectorAll("#conversations li")].slice(0, 10);
        for (const item of items) {
          item.click();
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      })()
    `);
  }
  const heldAfterwards = await page.webContents.executeJavaScript(`performance.memory?.usedJSHeapSize ?? 0`);
  detail.megabytesHeldAtFirst = Math.round(heldAtFirst / (1024 * 1024));
  detail.megabytesHeldAfterwards = Math.round(heldAfterwards / (1024 * 1024));
  const grewBy = detail.megabytesHeldAfterwards - detail.megabytesHeldAtFirst;
  detail.megabytesItGrewBy = grewBy;
  detail.roundsOfUse = rounds;
  // Loose on purpose: this is about noticing something that runs away, not about a number to the megabyte.
  detail.didNotRunAway = grewBy < 50;

  detail.problemsInTheConsole = problems.slice(0, 5);
  detail.complaintsWhileTheNetworkWasCut = complaintsWhileCut.length;
  detail.sendsRetriedWhileCatchingUp = recoveredFrom.length;
  const ok = problems.length === 0
    && detail.wentOutWhenTheNetworkCameBack === true
    && detail.arrivedWhileWatching === true
    && detail.didNotRunAway === true
    && detail.fileCanBeFetchedBack === true
    && detail.lookedFurtherBack === true;
  report(ok, ok ? "the example works in a real browser" : "the example ran but complained in the console");
}

app.whenReady().then(() => {
  run().catch(error => report(false, error instanceof Error ? error.message : String(error)));
});
app.on("window-all-closed", () => {});
