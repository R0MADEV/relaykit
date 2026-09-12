// Un gateway de notificaciones del tamaño minimo, para comprobar que el homeserver entrega de verdad.
// Vive dentro de la red de Docker porque el homeserver tiene que alcanzarlo por nombre, y en Docker Desktop
// una direccion del anfitrion no vale: el puente pertenece a la maquina virtual, no al portatil.
//
// Habla lo que dice el protocolo, `POST /_matrix/push/v1/notify`, y ademas ofrece `/received` para que una
// comprobacion pueda leer lo que llego, y `/received` con DELETE para empezar limpia.
import { createServer } from "node:http";

let received = [];

createServer((request, response) => {
  let body = "";
  request.on("data", chunk => { body += chunk; });
  request.on("end", () => {
    if (request.method === "POST" && request.url === "/_matrix/push/v1/notify") {
      try {
        received.push(JSON.parse(body).notification);
      } catch {
        // Lo que no se entiende no cuenta como recibido.
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ rejected: [] }));
      return;
    }
    if (request.method === "DELETE" && request.url === "/received") {
      received = [];
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/received") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(received));
      return;
    }
    response.writeHead(404);
    response.end();
  });
}).listen(8080, "0.0.0.0", () => console.log("push gateway listening"));
