"use strict";
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// What both browser checks need to get a page up: a secure origin to serve it from, and a way to wait for
// something to become true in it. Kept here because two checks doing this differently is two checks that can
// disagree about what a browser is.

/** A certificate for this check and nothing else. Made on the spot and thrown away afterwards. */
function makeCertificate() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "relaykit-tls-"));
  const key = path.join(folder, "tls.key");
  const certificate = path.join(folder, "tls.crt");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=localhost"
    ],
    { stdio: "ignore" }
  );
  return { key: fs.readFileSync(key), cert: fs.readFileSync(certificate) };
}

/**
 * Serves the built example over https, not over http on localhost. The browser treats localhost as a secure
 * origin by exception, so testing there does not test what a user will see: without a secure origin there is
 * no `crypto.subtle`, and without that the encrypted store does not start. A certificate of our own is enough
 * for the context to be genuinely secure, which is what has to be exercised.
 */
function serve(root) {
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm"
  };
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

/**
 * The certificate is our own, so it has to be accepted: what is being tested is the secure context, not who
 * signed it. Only for this server and this check.
 */
function acceptOwnCertificate(session) {
  session.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === "127.0.0.1" ? 0 : -3);
  });
}

async function waitFor(page, description, expression, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await page.webContents.executeJavaScript(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

module.exports = { serve, acceptOwnCertificate, waitFor };
