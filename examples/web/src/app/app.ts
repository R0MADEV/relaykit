/**
 * The shape of the application, with nothing behind it yet.
 *
 * Every screen of the design is laid out and can be moved between, filled with stand-in content so the form
 * can be judged before any of it is wired to the library. Nothing here talks to a homeserver: what each
 * piece will eventually ask for is named in a comment where it goes.
 */

interface Person {
  readonly initials: string;
  readonly name: string;
  readonly extension: string;
  readonly there?: "here" | "away";
}

const people: readonly Person[] = [
  { initials: "AM", name: "Adrián Meléndez", extension: "2275", there: "here" },
  { initials: "AM", name: "Aitana Malabe", extension: "2551", there: "here" },
  { initials: "SP", name: "Sergio Peña", extension: "2590", there: "away" },
  { initials: "SB", name: "Soraya Ben", extension: "2232", there: "here" },
  { initials: "AS", name: "Ainara Saracho", extension: "2571", there: "here" }
];

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The design has no ${id}`);
  return found as T;
};

/** Which of the three things the middle of the screen is showing. */
function show(view: "chat" | "rooms" | "lobby"): void {
  element("chat-view").hidden = view !== "chat";
  element("rooms-view").hidden = view !== "rooms";
  element("lobby-view").hidden = view !== "lobby";
  element("call-bar").hidden = view === "rooms";
}

/** Going into the room: it is on screen, so nothing has to stand in for it. */
function enterRoom(): void {
  show("rooms");
  element("mini").hidden = true;
}

/** Leaving the room on screen while staying on the call: the widget stands in for it. */
function minimise(): void {
  show("chat");
  element("mini").hidden = false;
}

// --- the sidebar: conversations.list(), told apart by isDirect -------------

function paintLists(): void {
  const channels = [
    { name: "general", unread: 0, live: false },
    { name: "incidencias-voz", unread: 4, live: true },
    { name: "despliegue-deitu", unread: 1, live: false },
    { name: "guardia-privada", unread: 0, live: false, shut: true }
  ];
  element("channels").innerHTML = channels
    .map(
      (channel, at) => `
      <li><button ${at === 1 ? 'aria-current="true"' : ""}>
        <span class="hash" aria-hidden="true">${channel.shut ? "🔒" : "#"}</span>
        <span class="name">${channel.name}</span>
        ${channel.live ? '<span class="live">● LIVE</span>' : ""}
        ${channel.unread ? `<span class="badge">${channel.unread}</span>` : ""}
      </button></li>`
    )
    .join("");

  const directs = [
    { who: people[1], unread: 2 },
    { who: people[4], unread: 1 },
    { who: people[3], unread: 0 },
    { who: people[2], unread: 0 }
  ];
  element("directs").innerHTML = directs
    .map(
      direct => `
      <li><button>
        <span class="avatar" data-there="${direct.who?.there}">${direct.who?.initials}</span>
        <span class="name">${direct.who?.name}</span>
        ${direct.unread ? `<span class="badge">${direct.unread}</span>` : ""}
      </button></li>`
    )
    .join("");
}

// --- the timeline: messages.list(), plus what each message carries ---------

function paintTimeline(): void {
  element("timeline").innerHTML = `
    <p class="day">Martes, 1 de septiembre</p>

    <div class="said">
      <span class="avatar big">SP</span>
      <div>
        <p class="who"><strong>Sergio Peña</strong><span class="at">09:12</span><span class="tag">Guardia</span></p>
        <p>Corte parcial en la sede norte: el SBC secundario no registra. Abro incidencia.</p>
        <div class="reactions"><button class="reaction">:eyes: 4</button></div>
      </div>
    </div>

    <div class="said same"><span class="at">09:14</span><p>Confirmado, afecta a 40 extensiones del edificio Amigos.</p></div>

    <div class="said">
      <span class="avatar big">AM</span>
      <div>
        <p class="who"><strong>Aitana Malabe</strong><span class="at">09:20</span></p>
        <p>¿Aviso a Secretaría o lo gestionáis vosotros? Tengo tres llamadas en cola.</p>
        <button class="in-thread" id="open-thread">↩ 5 respuestas en hilo</button>
      </div>
    </div>

    <div class="said">
      <span class="avatar big">AH</span>
      <div>
        <p class="who"><strong>Alberto Hernán</strong><span class="at">09:31</span></p>
        <p>Rutas reencaminadas al primario. 240 ms p95 estables.</p>
        <div class="reactions">
          <button class="reaction">:+1: 6</button><button class="reaction">:tada: 2</button>
        </div>
      </div>
    </div>

    <p class="day">Hoy</p>

    <div class="said">
      <span class="avatar big">SP</span>
      <div>
        <p class="who"><strong>Sergio Peña</strong><span class="at">10:02</span></p>
        <!-- message.invitesTo says this is one; who is inside comes from calls.list() -->
        <div class="card invite-card">
          <span class="card-icon" aria-hidden="true">▭</span>
          <div>
            <p class="label">Invitación a sala</p>
            <strong>Post-mortem incidencia voz</strong>
            <p class="mono faint">3 personas dentro</p>
          </div>
          <div class="spacer"></div>
          <button class="button accent" id="enter-room">Entrar</button>
        </div>
      </div>
    </div>

    <div class="said">
      <span class="avatar big">SB</span>
      <div>
        <p class="who"><strong>Soraya Ben</strong><span class="at">10:05</span></p>
        <p>Me uno en cinco, termino una llamada.</p>
      </div>
    </div>

    <!-- calls.history(): one participant means nobody else ever came -->
    <div class="said">
      <span class="avatar big">AM</span>
      <div>
        <p class="who"><strong>Aitana Malabe</strong><span class="at">17:20</span></p>
        <div class="card over-card">
          <span class="card-icon" aria-hidden="true">▭</span>
          <div>
            <p class="label">Sala caducada</p>
            <strong>Revisión rápida del acta</strong>
            <p class="mono faint">Nadie entró · la sala se cerró sola</p>
          </div>
        </div>
        <div class="card over-card">
          <span class="card-icon" aria-hidden="true">◷</span>
          <div>
            <p class="label">Conferencia finalizada</p>
            <strong>Acta de la comisión</strong>
            <p class="mono faint">2 participantes · 14 min 22 s</p>
          </div>
          <div class="spacer"></div>
          <button class="button">Ver detalle</button>
        </div>
      </div>
    </div>`;
}

// --- a thread: messages.thread(rootId) ------------------------------------

function paintThread(): void {
  const answers = [
    ["SP", "Sergio Peña", "09:22", "Lo gestionamos nosotros, pero avisa tú a Secretaría: es su edificio."],
    ["AM", "Aitana Malabe", "09:24", "Hecho. Les digo que desvíen al 2551 mientras dure el corte."],
    ["AH", "Alberto Hernán", "09:26", "Desvío aplicado en la centralita, sin pérdida de llamadas."],
    ["AM", "Aitana Malabe", "09:28", "Perfecto, ya no entran quejas en el mostrador."],
    ["SP", "Sergio Peña", "09:30", "Cierro el aviso cuando el secundario vuelva a registrar."]
  ];
  element("thread-body").innerHTML = `
    <div class="said">
      <span class="avatar big">AM</span>
      <div>
        <p class="who"><strong>Aitana Malabe</strong><span class="at">09:20</span></p>
        <p>¿Aviso a Secretaría o lo gestionáis vosotros? Tengo tres llamadas en cola.</p>
      </div>
    </div>
    <p class="thread-count">${answers.length} respuestas</p>
    ${answers
      .map(
        ([initials, name, at, said]) => `
      <div class="said">
        <span class="avatar big">${initials}</span>
        <div>
          <p class="who"><strong>${name}</strong><span class="at">${at}</span></p>
          <p>${said}</p>
        </div>
      </div>`
      )
      .join("")}`;
}

// --- a room: calls.list() and what each participant is sending -------------

function paintGrid(): void {
  const seats = [
    { initials: "SP", name: "Sergio Peña", sharing: true },
    { initials: "AH", name: "Alberto Hernán" },
    { initials: "SB", name: "Soraya Ben", quiet: true }
  ];
  element("grid").innerHTML = seats
    .map(
      seat => `
      <div class="seat" ${seat.sharing ? "data-sharing" : ""}>
        ${seat.sharing ? '<span class="seat-sharing">Pantalla</span>' : ""}
        <span class="avatar">${seat.initials}</span>
        <span class="seat-name">${seat.name}${seat.quiet ? " 🔇" : ""}</span>
      </div>`
    )
    .join("");
}

// --- who can be added to something: users.search() -------------------------

function paintPeople(id: string, picked: number): void {
  element(id).innerHTML = people
    .map(
      (person, at) => `
      <li ${at < picked ? "data-picked" : ""}>
        <span class="avatar" data-there="${person.there}">${person.initials}</span>
        <span class="who-name">${person.name}</span>
        <span class="mono faint">${person.extension}</span>
        <input type="checkbox" ${at < picked ? "checked" : ""} />
      </li>`
    )
    .join("");
}

// --- moving between them ---------------------------------------------------

function wire(): void {
  const menu = element("new-menu");
  element("new-button").addEventListener("click", () => {
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", event => {
    const inside = (event.target as HTMLElement).closest(".new");
    if (!inside) menu.hidden = true;
  });

  for (const opener of document.querySelectorAll<HTMLElement>("[data-opens]")) {
    opener.addEventListener("click", () => {
      menu.hidden = true;
      element<HTMLDialogElement>(opener.dataset.opens ?? "").showModal();
    });
  }

  const thread = element("thread");
  element("open-thread").addEventListener("click", () => {
    thread.hidden = false;
  });
  element("thread-close").addEventListener("click", () => {
    thread.hidden = true;
  });

  element("enter-room").addEventListener("click", enterRoom);
  element("open-room").addEventListener("click", () => show("lobby"));
  element("minimise").addEventListener("click", minimise);
  element("mini-open").addEventListener("click", enterRoom);
  element("call-bar-back").addEventListener("click", enterRoom);
  element("call-bar-leave").addEventListener("click", () => {
    element("call-bar").hidden = true;
    element("mini").hidden = true;
  });
  element("copy-link").addEventListener("click", () => {
    // conversations.link() gives this, and it is a matrix.to link any client can open.
    void navigator.clipboard?.writeText(element<HTMLInputElement>("invite-link").value);
  });
}

paintLists();
paintTimeline();
paintThread();
paintGrid();
paintPeople("create-people", 0);
paintPeople("invite-people", 3);
paintPeople("new-message-people", 0);
wire();
show("chat");
element("call-bar").hidden = false;
// A chat opens at the newest thing said in it, not at the oldest.
element("timeline").scrollTop = element("timeline").scrollHeight;
