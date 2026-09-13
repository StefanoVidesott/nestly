const API = "/api";

document.getElementById("oggi").textContent = new Date().toLocaleDateString("en-US", {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
});
document.getElementById("oggi-mobile").textContent = new Date().toLocaleDateString("en-US");

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiSend(path, method, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

function formattaData(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

let currentUser = null;

// ================= AUTENTICAZIONE =================

const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errore = document.getElementById("login-errore");
  errore.classList.add("hidden");
  try {
    const user = await apiSend("/auth/login", "POST", {
      username: document.getElementById("login-username").value,
      password: document.getElementById("login-password").value,
    });
    avviaApp(user);
  } catch (err) {
    errore.textContent = "Incorrect username or password";
    errore.classList.remove("hidden");
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await apiSend("/auth/logout", "POST");
  location.reload();
});

async function verificaSessione() {
  try {
    const user = await apiGet("/auth/me");
    avviaApp(user);
  } catch {
    loginScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
  }
}

function avviaApp(user) {
  currentUser = user;
  loginScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  appShell.classList.add("flex");
  document.getElementById("nome-utente").textContent = `${user.username} (${user.role === "admin" ? "admin" : "user"})`;
  renderSidebar(user);

  const primaSezione = user.allowed_modules[0] || (user.role === "admin" ? "admin" : null);
  const salvata = localStorage.getItem("sezioneAttiva");
  const sezioniValide = [...user.allowed_modules, ...(user.role === "admin" ? ["admin"] : [])];
  mostraSezione(sezioniValide.includes(salvata) ? salvata : primaSezione);

  for (const modulo of user.allowed_modules) {
    (CARICATORI_MODULO[modulo] || []).forEach((fn) => fn());
  }
}

verificaSessione();

// ================= SIDEBAR DINAMICA & NAVIGAZIONE =================

const MODULO_META = {
  lavanderia: { label: "Laundry", icon: "fa-shirt" },
  stanza: { label: "Room & Cleaning", icon: "fa-broom" },
  dispensa: { label: "Pantry & Fridge", icon: "fa-kitchen-set" },
  finanza: { label: "Finance & Expenses", icon: "fa-sack-dollar" },
  kanban: { label: "Kanban", icon: "fa-table-columns" },
  bucketlist: { label: "Bucket List", icon: "fa-list-check" },
  trondheim: { label: "Trondheim", icon: "fa-city" },
  bookmark: { label: "Bookmarks & Resources", icon: "fa-bookmark" },
  mealplan: { label: "Kitchen & Meal Plan", icon: "fa-utensils" },
  pulizie: { label: "Chores", icon: "fa-arrows-rotate" },
};

const CARICATORI_MODULO = {
  lavanderia: [caricaLavanderia, caricaBucato],
  stanza: [caricaIgiene],
  dispensa: [caricaFrigo, caricaListaSpesa, caricaRicette],
  finanza: [caricaTassoCambio],
  kanban: [caricaKanban, caricaTodo],
  bucketlist: [caricaBucketList],
  trondheim: [avviaTrasporti, caricaKp, caricaMeteo],
  bookmark: [caricaBookmark],
  mealplan: [caricaAntiSpreco, caricaGrigliaMealPlan],
  pulizie: [caricaPulizie],
};

function renderModuliCheckbox(container, selezionati = []) {
  container.innerHTML = "";
  for (const [chiave, meta] of Object.entries(MODULO_META)) {
    const label = document.createElement("label");
    label.className = "flex items-center gap-1.5 text-sm";
    label.innerHTML = `<input type="checkbox" value="${chiave}" class="accent-indigo-600" ${selezionati.includes(chiave) ? "checked" : ""}/> ${meta.label}`;
    container.appendChild(label);
  }
}
renderModuliCheckbox(document.getElementById("nu-moduli"));

function renderSidebar(user) {
  const nav = document.getElementById("nav-menu");
  nav.innerHTML = "";
  for (const modulo of user.allowed_modules) {
    const meta = MODULO_META[modulo];
    if (!meta) continue;
    nav.appendChild(creaVoceNav(modulo, meta.label, meta.icon));
  }
  if (user.role === "admin") {
    nav.appendChild(creaVoceNav("admin", "Admin Settings", "fa-user-shield"));
  }
}

function creaVoceNav(target, label, icon) {
  const btn = document.createElement("button");
  btn.dataset.target = target;
  btn.className = "nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition";
  btn.innerHTML = `<i class="fa-solid ${icon} w-5 text-center"></i> ${label}`;
  btn.addEventListener("click", () => mostraSezione(target));
  return btn;
}

const sections = document.querySelectorAll("main > section");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");

const TITOLI = {
  lavanderia: "Laundry", stanza: "Room & Cleaning", dispensa: "Pantry & Fridge",
  finanza: "Finance & Expenses", admin: "Admin Settings",
  kanban: "Kanban", bucketlist: "Bucket List", trondheim: "Trondheim",
  bookmark: "Bookmarks & Resources", mealplan: "Kitchen & Meal Plan",
  pulizie: "Chores",
};

function attivaVoceNav(target) {
  document.querySelectorAll(".nav-link").forEach((b) => {
    const attivo = b.dataset.target === target;
    b.classList.toggle("bg-indigo-50", attivo);
    b.classList.toggle("dark:bg-indigo-950", attivo);
    b.classList.toggle("text-indigo-600", attivo);
    b.classList.toggle("dark:text-indigo-400", attivo);
    b.classList.toggle("text-slate-600", !attivo);
    b.classList.toggle("dark:text-slate-300", !attivo);
  });
}

function mostraSezione(target) {
  if (!target) return;
  sections.forEach((s) => s.classList.toggle("hidden", s.id !== `section-${target}`));
  attivaVoceNav(target);
  document.getElementById("titolo-mobile").textContent = TITOLI[target] || "Nestly";
  localStorage.setItem("sezioneAttiva", target);
  chiudiSidebarMobile();
  if (target === "finanza") inizializzaTabulatorSeNecessario();
  if (target === "admin") caricaListaUtenti();
}

function chiudiSidebarMobile() {
  sidebar.classList.add("-translate-x-full");
  overlay.classList.add("hidden");
}
function apriSidebarMobile() {
  sidebar.classList.remove("-translate-x-full");
  overlay.classList.remove("hidden");
}
document.getElementById("hamburger").addEventListener("click", apriSidebarMobile);
overlay.addEventListener("click", chiudiSidebarMobile);

// ================= DARK MODE =================

document.getElementById("theme-toggle").addEventListener("click", () => {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
});

// ================= 1. LAVANDERIA =================

async function caricaLavanderia() {
  const prenotazioni = await apiGet("/lavanderia");
  const cont = document.getElementById("lista-lavanderia");
  cont.innerHTML = "";
  if (prenotazioni.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">No bookings</p>`;
    return;
  }
  for (const p of prenotazioni) {
    const icona = p.macchina === "Lavatrice" ? "fa-jug-detergent" : "fa-wind";
    const div = document.createElement("div");
    div.className = "flex items-center justify-between bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm";
    div.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fa-solid ${icona} text-indigo-500"></i>
        <span class="font-medium">${p.macchina}</span>
        <span class="text-slate-400">${formattaData(p.data)} · ${p.ora_inizio.slice(0,5)}–${p.ora_fine.slice(0,5)}</span>
      </div>
      <button data-id="${p.id}" class="btn-del-lav text-slate-400 hover:text-red-500"><i class="fa-solid fa-trash"></i></button>
    `;
    cont.appendChild(div);
  }
  cont.querySelectorAll(".btn-del-lav").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiSend(`/lavanderia/${btn.dataset.id}`, "DELETE");
      caricaLavanderia();
    });
  });
}

document.getElementById("form-lavanderia").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    macchina: document.getElementById("lav-macchina").value,
    data: document.getElementById("lav-data").value,
    ora_inizio: document.getElementById("lav-inizio").value,
    ora_fine: document.getElementById("lav-fine").value,
  };
  try {
    await apiSend("/lavanderia", "POST", body);
    e.target.reset();
    caricaLavanderia();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

// ================= 2. CESTO BIANCHERIA =================

const TEMPERATURE = [30, 40, 60];
const INFO_TEMPERATURA = {
  30: "Delicate items, dark colors, sportswear, items that may shrink.",
  40: "Cotton t-shirts, jeans, sweatshirts, everyday clothing.",
  60: "Towels, sheets, pillowcases, dish cloths, underwear (for sanitizing).",
};

function creaCapoBucato(c) {
  const item = document.createElement("div");
  item.className = "bg-slate-50 dark:bg-slate-800 text-xs rounded px-2 py-1";
  item.innerHTML = `
    <div class="flex items-center justify-between gap-1 vista-capo">
      <span class="truncate">${c.nome}</span>
      <div class="flex items-center gap-1.5 shrink-0">
        <button class="btn-edit-capo text-slate-400 hover:text-indigo-600"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-del-capo text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <form class="edit-capo hidden items-center gap-1 mt-1">
      <input type="text" class="edit-nome flex-1 min-w-0 border border-slate-300 dark:border-slate-700 dark:bg-slate-900 rounded px-1.5 py-0.5 text-xs" value="${c.nome}" />
      <select class="edit-temp border border-slate-300 dark:border-slate-700 dark:bg-slate-900 rounded px-1 py-0.5 text-xs">
        <option value="30" ${c.temperatura === 30 ? "selected" : ""}>30°C</option>
        <option value="40" ${c.temperatura === 40 ? "selected" : ""}>40°C</option>
        <option value="60" ${c.temperatura === 60 ? "selected" : ""}>60°C</option>
      </select>
      <button type="submit" class="text-emerald-600 hover:text-emerald-700 shrink-0"><i class="fa-solid fa-check"></i></button>
      <button type="button" class="btn-annulla-capo text-slate-400 hover:text-red-500 shrink-0"><i class="fa-solid fa-xmark"></i></button>
    </form>
  `;
  const vista = item.querySelector(".vista-capo");
  const editForm = item.querySelector(".edit-capo");
  item.querySelector(".btn-edit-capo").addEventListener("click", () => {
    vista.classList.add("hidden");
    editForm.classList.remove("hidden");
    editForm.classList.add("flex");
  });
  item.querySelector(".btn-annulla-capo").addEventListener("click", () => {
    editForm.classList.add("hidden");
    editForm.classList.remove("flex");
    vista.classList.remove("hidden");
  });
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiSend(`/bucato/${c.id}`, "PATCH", {
      nome: editForm.querySelector(".edit-nome").value,
      temperatura: parseInt(editForm.querySelector(".edit-temp").value, 10),
    });
    caricaBucato();
  });
  item.querySelector(".btn-del-capo").addEventListener("click", async () => {
    await apiSend(`/bucato/${c.id}`, "DELETE");
    caricaBucato();
  });
  return item;
}

async function caricaBucato() {
  const capi = await apiGet("/bucato");
  const cont = document.getElementById("colonne-bucato");
  cont.innerHTML = "";
  for (const temp of TEMPERATURE) {
    const capiTemp = capi.filter((c) => c.temperatura === temp);
    const col = document.createElement("div");
    col.className = "border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col";
    col.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="font-semibold text-sm flex items-center gap-1">
          ${temp}°C
          <span class="relative group cursor-help">
            <i class="fas fa-info-circle text-slate-400"></i>
            <div class="hidden group-hover:block absolute z-20 left-0 top-6 w-52 text-xs bg-slate-800 text-white rounded-lg p-2 shadow-lg">${INFO_TEMPERATURA[temp]}</div>
          </span>
        </span>
        <span class="text-xs bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-full px-2 py-0.5">${capiTemp.length}</span>
      </div>
      <div class="flex-1 space-y-1 min-h-[60px] mb-2" id="col-${temp}"></div>
      <button data-temp="${temp}" class="btn-lava text-xs bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-lg py-1.5 disabled:opacity-30" ${capiTemp.length === 0 ? "disabled" : ""}>
        <i class="fa-solid fa-rotate"></i> Run Washer
      </button>
    `;
    cont.appendChild(col);
    const list = col.querySelector(`#col-${temp}`);
    for (const c of capiTemp) {
      list.appendChild(creaCapoBucato(c));
    }
  }
  cont.querySelectorAll(".btn-lava").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiSend(`/bucato/lava/${btn.dataset.temp}`, "POST");
      caricaBucato();
    });
  });
}

document.getElementById("form-bucato").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    nome: document.getElementById("bucato-nome").value,
    temperatura: parseInt(document.getElementById("bucato-temp").value, 10),
  };
  await apiSend("/bucato", "POST", body);
  document.getElementById("bucato-nome").value = "";
  caricaBucato();
});

// ================= 3. STANZA & PULIZIE (IGIENE) =================

const ICONE_IGIENE = { cleaning: "fa-broom", towels: "fa-shower", sheets: "fa-bed" };

async function caricaIgiene() {
  const [tipi, stati] = await Promise.all([apiGet("/igiene/tipi"), apiGet("/igiene")]);
  const cont = document.getElementById("lista-igiene");
  cont.innerHTML = "";
  for (const t of tipi) {
    const stato = stati[t.tipo];
    const icona = ICONE_IGIENE[t.tipo] || "fa-bell";
    const div = document.createElement("div");
    div.className = "bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5";
    div.dataset.tipo = t.tipo;
    div.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-semibold flex items-center gap-2">
          <i class="fa-solid ${icona} text-indigo-600"></i> <span class="capitalize">${t.tipo}</span>
        </h2>
        <button class="btn-del-igiene-tipo text-slate-400 hover:text-red-500"><i class="fa-solid fa-trash"></i></button>
      </div>
      <div class="flex flex-col items-center gap-3 py-2">
        <div class="indicatore-igiene text-4xl font-bold px-6 py-4 rounded-2xl border-2"></div>
        <p class="sottotitolo-igiene text-xs text-slate-500 dark:text-slate-400 text-center"></p>
        <button class="btn-igiene bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition">
          <i class="fa-solid fa-check"></i> Done today
        </button>
        <form class="form-igiene-giorni flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
          <span>every</span>
          <input type="number" min="1" value="${t.target_giorni}" class="w-14 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-2 py-1 text-center" />
          <span>days</span>
          <button class="text-indigo-600 hover:text-indigo-700"><i class="fa-solid fa-floppy-disk"></i></button>
        </form>
      </div>
    `;
    aggiornaIndicatoreIgiene(div, stato);
    cont.appendChild(div);
  }

  cont.querySelectorAll(".btn-igiene").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tipo = btn.closest("[data-tipo]").dataset.tipo;
      await apiSend(`/igiene/${tipo}`, "POST");
      caricaIgiene();
    });
  });
  cont.querySelectorAll(".btn-del-igiene-tipo").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tipo = btn.closest("[data-tipo]").dataset.tipo;
      if (!confirm(`Delete reminder "${tipo}" and its history?`)) return;
      await apiSend(`/igiene/tipi/${tipo}`, "DELETE");
      caricaIgiene();
    });
  });
  cont.querySelectorAll(".form-igiene-giorni").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const tipo = form.closest("[data-tipo]").dataset.tipo;
      const giorni = Number(form.querySelector("input").value);
      await apiSend(`/igiene/tipi/${tipo}`, "PUT", { target_giorni: giorni });
      caricaIgiene();
    });
  });
}

function aggiornaIndicatoreIgiene(container, stato) {
  const indicatore = container.querySelector(".indicatore-igiene");
  const sottotitolo = container.querySelector(".sottotitolo-igiene");

  if (!stato || stato.ultima_data === null) {
    indicatore.textContent = "—";
    indicatore.className = "indicatore-igiene text-4xl font-bold px-6 py-4 rounded-2xl border-2 border-slate-300 dark:border-slate-600 text-slate-400";
    sottotitolo.textContent = "Never logged";
    return;
  }

  const scaduto = stato.scaduto;
  const giorni = stato.giorni_rimanenti;
  indicatore.textContent = scaduto ? `+${Math.abs(giorni)}` : giorni;
  indicatore.className = `indicatore-igiene text-4xl font-bold px-6 py-4 rounded-2xl border-2 ${
    scaduto
      ? "border-red-400 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400"
      : "border-emerald-400 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"
  }`;
  sottotitolo.textContent = scaduto
    ? `${Math.abs(giorni)} days overdue (last: ${formattaData(stato.ultima_data)})`
    : `Days remaining (last: ${formattaData(stato.ultima_data)})`;
}

document.getElementById("form-igiene-tipo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    tipo: document.getElementById("igiene-tipo-nome").value.trim(),
    target_giorni: Number(document.getElementById("igiene-tipo-giorni").value),
  };
  await apiSend("/igiene/tipi", "POST", body);
  e.target.reset();
  caricaIgiene();
});

// ================= 4. DISPENSA & FRIGO =================

async function caricaFrigo() {
  const items = await apiGet("/frigo");
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);

  renderListaFrigo(
    items.filter((it) => (it.luogo || "frigo") === "frigo"),
    "lista-frigo",
    "Fridge is empty",
    oggi
  );
  renderListaFrigo(
    items.filter((it) => it.luogo === "freezer"),
    "lista-freezer",
    "Freezer is empty",
    oggi
  );
}

function renderListaFrigo(items, contId, emptyMsg, oggi) {
  const cont = document.getElementById(contId);
  cont.innerHTML = "";
  if (items.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">${emptyMsg}</p>`;
    return;
  }
  for (const it of items) {
    cont.appendChild(creaRigaFrigo(it, oggi));
  }
}

function creaRigaFrigo(it, oggi) {
  let evidenzia = false;
  let etichetta = "";
  if (it.scadenza) {
    const scad = new Date(it.scadenza);
    const giorni = Math.round((scad - oggi) / 86400000);
    evidenzia = giorni < 2;
    etichetta = giorni < 0 ? "Expired" : giorni === 0 ? "Expires today" : `Expires in ${giorni}d`;
  }
  const div = document.createElement("div");
  div.className = `flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm border ${
    evidenzia
      ? "bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700"
      : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
  }`;
  div.innerHTML = `
    <div class="flex items-center gap-2 flex-1 min-w-0 vista-frigo">
      ${evidenzia ? '<i class="fa-solid fa-triangle-exclamation text-amber-500 shrink-0"></i>' : ""}
      <span class="font-medium truncate">${it.nome}</span>
      <span class="text-slate-400 shrink-0">× ${it.quantita}</span>
      ${it.scadenza ? `<span class="text-xs shrink-0 ${evidenzia ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}">${etichetta}</span>` : ""}
    </div>
    <form class="edit-frigo hidden flex-1 items-center gap-1">
      <input type="text" class="edit-nome flex-1 min-w-0 border border-slate-300 dark:border-slate-700 dark:bg-slate-900 rounded px-2 py-1 text-sm" value="${it.nome}" />
      <input type="text" class="edit-quantita w-16 border border-slate-300 dark:border-slate-700 dark:bg-slate-900 rounded px-2 py-1 text-sm" value="${it.quantita}" />
      <button type="submit" class="text-emerald-600 hover:text-emerald-700 shrink-0"><i class="fa-solid fa-check"></i></button>
      <button type="button" class="btn-annulla-frigo text-slate-400 hover:text-red-500 shrink-0"><i class="fa-solid fa-xmark"></i></button>
    </form>
    <div class="flex items-center gap-2 shrink-0">
      <button class="btn-edit-frigo text-slate-400 hover:text-indigo-600"><i class="fa-solid fa-pen"></i></button>
      <button class="btn-del-frigo text-slate-400 hover:text-red-500"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
  const vista = div.querySelector(".vista-frigo");
  const editForm = div.querySelector(".edit-frigo");
  div.querySelector(".btn-edit-frigo").addEventListener("click", () => {
    vista.classList.add("hidden");
    editForm.classList.remove("hidden");
    editForm.classList.add("flex");
  });
  div.querySelector(".btn-annulla-frigo").addEventListener("click", () => {
    editForm.classList.add("hidden");
    editForm.classList.remove("flex");
    vista.classList.remove("hidden");
  });
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiSend(`/frigo/${it.id}`, "PATCH", {
      nome: editForm.querySelector(".edit-nome").value,
      quantita: editForm.querySelector(".edit-quantita").value,
    });
    caricaFrigo();
  });
  div.querySelector(".btn-del-frigo").addEventListener("click", async () => {
    await apiSend(`/frigo/${it.id}`, "DELETE");
    caricaFrigo();
  });
  return div;
}

document.getElementById("form-frigo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const scadenza = document.getElementById("frigo-scadenza").value;
  const body = {
    nome: document.getElementById("frigo-nome").value,
    quantita: document.getElementById("frigo-quantita").value,
    scadenza: scadenza || null,
    luogo: "frigo",
  };
  await apiSend("/frigo", "POST", body);
  e.target.reset();
  caricaFrigo();
});

document.getElementById("form-freezer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const scadenza = document.getElementById("freezer-scadenza").value;
  const body = {
    nome: document.getElementById("freezer-nome").value,
    quantita: document.getElementById("freezer-quantita").value,
    scadenza: scadenza || null,
    luogo: "freezer",
  };
  await apiSend("/frigo", "POST", body);
  e.target.reset();
  caricaFrigo();
});

// ---- Scan barcode ----
// Uses html5-qrcode instead of raw BarcodeDetector/ZXing: it manages its own
// <video>/<canvas> inside #scan-camera-wrap and, crucially, only decodes a
// cropped center "qrbox" region instead of the full raw frame — full-frame
// decoding on a 1920x1080 image was the reason plain ZXing never found a
// real barcode despite thousands of attempts.

let scanInPausa = false;
let scanTentativi = 0;
let html5QrCode = null;

const modaleScan = document.getElementById("modal-scan");
const scanStato = document.getElementById("scan-stato");
const scanDebug = document.getElementById("scan-debug");
const formScanProdotto = document.getElementById("form-scan-prodotto");

function beepScan() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close();
  } catch (e) {
    // audio not available, ignore
  }
}

async function apriModaleScan() {
  modaleScan.classList.remove("hidden");
  modaleScan.classList.add("flex");
  scanStato.textContent = "Point the camera at an EAN-13 barcode";
  scanStato.classList.remove("hidden");
  formScanProdotto.classList.add("hidden");
  scanInPausa = false;
  scanTentativi = 0;
  scanDebug.textContent = "starting camera…";

  try {
    html5QrCode = new Html5Qrcode("scan-camera-wrap", {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.EAN_8,
      ],
      verbose: false,
    });
    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 280, height: 140 },
        videoConstraints: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      },
      (decodedText) => {
        if (scanInPausa) return;
        scanDebug.textContent = `${scanVideoInfo()} · tentativi: ${scanTentativi} · trovato!`;
        gestisciBarcodeRilevato(decodedText);
      },
      () => {
        if (scanInPausa) return;
        scanTentativi++;
        scanDebug.textContent = `${scanVideoInfo()} · tentativi: ${scanTentativi}`;
      }
    );
  } catch (e) {
    scanStato.textContent = "Camera access denied or unavailable.";
    scanDebug.textContent = String(e);
  }
}

function scanVideoInfo() {
  const v = document.querySelector("#scan-camera-wrap video");
  if (!v) return "video: n/a";
  return `real ${v.videoWidth}x${v.videoHeight} · shown ${Math.round(v.clientWidth)}x${Math.round(v.clientHeight)}`;
}

function chiudiModaleScan() {
  modaleScan.classList.add("hidden");
  modaleScan.classList.remove("flex");
  fermaRilevamento();
  formScanProdotto.classList.add("hidden");
  formScanProdotto.reset();
}

function fermaRilevamento() {
  if (html5QrCode) {
    const reader = html5QrCode;
    html5QrCode = null;
    reader
      .stop()
      .then(() => reader.clear())
      .catch(() => {
        // already stopped or never fully started, ignore
      });
  }
}

async function gestisciBarcodeRilevato(barcode) {
  if (scanInPausa) return;
  scanInPausa = true;
  beepScan();
  scanStato.textContent = `Scanned: ${barcode}`;

  const res = await fetch(`${API}/prodotti/${barcode}/scan`, { method: "POST" });
  if (res.ok) {
    const item = await res.json();
    const luogoLabel = item.luogo === "freezer" ? "Freezer" : "Fridge";
    scanStato.textContent = `✓ Added ${item.nome} to ${luogoLabel}`;
    caricaFrigo();
    setTimeout(() => {
      scanStato.textContent = "Point the camera at an EAN-13 barcode";
      scanInPausa = false;
    }, 1500);
    return;
  }

  if (res.status === 404) {
    document.getElementById("sp-barcode").value = barcode;
    document.getElementById("sp-nome").value = "";
    document.getElementById("sp-quantita").value = "";
    document.getElementById("sp-giorni").value = "";
    document.getElementById("sp-luogo").value = "frigo";

    try {
      const off = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
      if (off.ok) {
        const dati = await off.json();
        if (dati.product && dati.product.product_name) {
          document.getElementById("sp-nome").value = dati.product.product_name;
        }
        if (dati.product && dati.product.quantity) {
          document.getElementById("sp-quantita").value = dati.product.quantity;
        }
      }
    } catch (e) {
      // Open Food Facts unavailable, leave fields empty for manual entry
    }

    scanStato.textContent = "New product — fill in the details";
    formScanProdotto.classList.remove("hidden");
    return;
  }

  scanStato.textContent = "Error while adding product.";
  scanInPausa = false;
}

document.getElementById("btn-apri-scan").addEventListener("click", apriModaleScan);
document.getElementById("scan-chiudi").addEventListener("click", chiudiModaleScan);
modaleScan.addEventListener("click", (e) => {
  if (e.target === modaleScan) chiudiModaleScan();
});

document.getElementById("scan-annulla-prodotto").addEventListener("click", () => {
  formScanProdotto.classList.add("hidden");
  formScanProdotto.reset();
  scanStato.textContent = "Point the camera at an EAN-13 barcode";
  scanInPausa = false;
});

formScanProdotto.addEventListener("submit", async (e) => {
  e.preventDefault();
  const barcode = document.getElementById("sp-barcode").value;
  const giorni = document.getElementById("sp-giorni").value;
  const body = {
    barcode,
    nome: document.getElementById("sp-nome").value,
    quantita_default: document.getElementById("sp-quantita").value,
    scadenza_giorni_default: giorni ? parseInt(giorni, 10) : null,
    luogo_default: document.getElementById("sp-luogo").value,
  };
  await apiSend("/prodotti", "POST", body);
  const item = await apiSend(`/prodotti/${barcode}/scan`, "POST");
  const luogoLabel = item.luogo === "freezer" ? "Freezer" : "Fridge";

  formScanProdotto.classList.add("hidden");
  formScanProdotto.reset();
  scanStato.textContent = `✓ Added ${item.nome} to ${luogoLabel}`;
  caricaFrigo();
  setTimeout(() => {
    scanStato.textContent = "Point the camera at an EAN-13 barcode";
    scanInPausa = false;
  }, 1500);
});

// ---- Lista della spesa (dentro Dispensa & Frigo) ----

async function caricaListaSpesa() {
  const items = await apiGet("/spesa");
  const cont = document.getElementById("lista-spesa-list");
  cont.innerHTML = "";
  if (items.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400 text-center py-2">List is empty</p>`;
    return;
  }
  for (const it of items) {
    cont.appendChild(creaRigaSpesa(it));
  }
}

function creaRigaSpesa(it) {
  const div = document.createElement("div");
  div.className = "flex items-center gap-2 text-sm px-1 py-1";
  div.innerHTML = `
    <input type="checkbox" class="chk-spesa w-4 h-4 accent-indigo-600 shrink-0" ${it.comprato ? "checked" : ""} />
    <div class="flex-1 min-w-0 flex items-center gap-2 vista-spesa">
      <span class="truncate ${it.comprato ? "line-through text-slate-400" : ""}">${it.nome}</span>
      ${it.quantita ? `<span class="text-slate-400 shrink-0">× ${it.quantita}</span>` : ""}
    </div>
    <form class="edit-spesa hidden flex-1 items-center gap-1">
      <input type="text" class="edit-nome flex-1 min-w-0 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded px-2 py-1 text-sm" value="${it.nome}" />
      <input type="text" class="edit-quantita w-16 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded px-2 py-1 text-sm" value="${it.quantita || ""}" />
      <button type="submit" class="text-emerald-600 hover:text-emerald-700 shrink-0"><i class="fa-solid fa-check"></i></button>
      <button type="button" class="btn-annulla-spesa text-slate-400 hover:text-red-500 shrink-0"><i class="fa-solid fa-xmark"></i></button>
    </form>
    <button class="btn-edit-spesa text-slate-400 hover:text-indigo-600 shrink-0"><i class="fa-solid fa-pen"></i></button>
    <button class="btn-del-spesa text-slate-400 hover:text-red-500 shrink-0"><i class="fa-solid fa-xmark"></i></button>
  `;
  div.querySelector(".chk-spesa").addEventListener("change", async () => {
    await apiSend(`/spesa/${it.id}`, "PATCH");
    caricaListaSpesa();
  });
  const vista = div.querySelector(".vista-spesa");
  const editForm = div.querySelector(".edit-spesa");
  div.querySelector(".btn-edit-spesa").addEventListener("click", () => {
    vista.classList.add("hidden");
    editForm.classList.remove("hidden");
    editForm.classList.add("flex");
  });
  div.querySelector(".btn-annulla-spesa").addEventListener("click", () => {
    editForm.classList.add("hidden");
    editForm.classList.remove("flex");
    vista.classList.remove("hidden");
  });
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiSend(`/spesa/${it.id}`, "PUT", {
      nome: editForm.querySelector(".edit-nome").value,
      quantita: editForm.querySelector(".edit-quantita").value || null,
    });
    caricaListaSpesa();
  });
  div.querySelector(".btn-del-spesa").addEventListener("click", async () => {
    await apiSend(`/spesa/${it.id}`, "DELETE");
    caricaListaSpesa();
  });
  return div;
}

document.getElementById("form-spesa-list").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    nome: document.getElementById("spesa-list-nome").value,
    quantita: document.getElementById("spesa-list-quantita").value || null,
  };
  await apiSend("/spesa", "POST", body);
  e.target.reset();
  caricaListaSpesa();
});

// ---- Recipes (dentro Dispensa & Frigo) ----

async function caricaRicette() {
  const items = await apiGet("/recipes");
  const cont = document.getElementById("lista-recipes");
  cont.innerHTML = "";
  if (items.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400 text-center py-4 col-span-full">No recipes yet</p>`;
    return;
  }
  for (const r of items) {
    cont.appendChild(creaRigaRicetta(r));
  }
}

function creaRigaRicetta(r) {
  const div = document.createElement("div");
  div.className = "border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm";
  div.innerHTML = `
    <div class="vista-recipe">
      <div class="flex items-start justify-between gap-2 mb-1">
        <span class="font-medium">${r.title}</span>
        ${r.is_mine
          ? `<div class="flex items-center gap-2 shrink-0">
               <button class="btn-edit-recipe text-slate-400 hover:text-indigo-600"><i class="fa-solid fa-pen"></i></button>
               <button class="btn-del-recipe text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
             </div>`
          : ""}
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line mb-2">${r.content}</p>
      <span class="text-xs ${r.is_mine ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400"}">
        ${r.is_mine
          ? (r.is_shared ? '<i class="fa-solid fa-users"></i> Shared' : '<i class="fa-solid fa-lock"></i> Private')
          : `<i class="fa-solid fa-users"></i> Shared by ${r.owner_username}`}
      </span>
    </div>
    ${r.is_mine ? `
    <form class="edit-recipe hidden flex-col gap-1.5 mt-2">
      <input type="text" class="edit-title border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded px-2 py-1 text-sm" value="${r.title}" />
      <textarea class="edit-content border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded px-2 py-1 text-xs resize-none" rows="3">${r.content}</textarea>
      <label class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <input type="checkbox" class="edit-shared w-4 h-4 accent-indigo-600" ${r.is_shared ? "checked" : ""} /> Share with household
      </label>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-annulla-recipe text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
        <button type="submit" class="text-emerald-600 hover:text-emerald-700"><i class="fa-solid fa-check"></i></button>
      </div>
    </form>` : ""}
  `;
  if (!r.is_mine) return div;

  const vista = div.querySelector(".vista-recipe");
  const editForm = div.querySelector(".edit-recipe");
  div.querySelector(".btn-edit-recipe").addEventListener("click", () => {
    vista.classList.add("hidden");
    editForm.classList.remove("hidden");
    editForm.classList.add("flex");
  });
  div.querySelector(".btn-annulla-recipe").addEventListener("click", () => {
    editForm.classList.add("hidden");
    editForm.classList.remove("flex");
    vista.classList.remove("hidden");
  });
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiSend(`/recipes/${r.id}`, "PUT", {
      title: editForm.querySelector(".edit-title").value,
      content: editForm.querySelector(".edit-content").value,
      is_shared: editForm.querySelector(".edit-shared").checked,
    });
    caricaRicette();
  });
  div.querySelector(".btn-del-recipe").addEventListener("click", async () => {
    await apiSend(`/recipes/${r.id}`, "DELETE");
    caricaRicette();
  });
  return div;
}

document.getElementById("form-recipe").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    title: document.getElementById("recipe-title").value,
    content: document.getElementById("recipe-content").value,
    is_shared: document.getElementById("recipe-shared").checked,
  };
  await apiSend("/recipes", "POST", body);
  e.target.reset();
  caricaRicette();
});

// ================= 6. FINANZA & SPESE =================

let tabellaSpese = null;

function inizializzaTabulatorSeNecessario() {
  if (tabellaSpese) return;
  tabellaSpese = new Tabulator("#tabella-spese", {
    layout: "fitColumns",
    placeholder: "No expenses recorded",
    columns: [
      { title: "Date", field: "data", sorter: "date", formatter: (cell) => formattaData(cell.getValue()), width: 110 },
      { title: "Description", field: "descrizione", editor: "input" },
      { title: "Category", field: "categoria", width: 130, editor: "input" },
      { title: "Amount", field: "importo", hozAlign: "right", width: 110, editor: "number", formatter: (cell) => cell.getValue().toFixed(2) },
      { title: "Currency", field: "valuta", width: 90 },
    ],
  });
  tabellaSpese.on("cellEdited", async (cell) => {
    const riga = cell.getRow().getData();
    const campo = cell.getField();
    try {
      await apiSend(`/spese/${riga.id}`, "PATCH", { [campo]: riga[campo] });
    } catch (err) {
      cell.restoreOldValue();
      alert("Error saving: " + err.message);
    }
  });
  caricaSpeseFinanza();
}

async function caricaSpeseFinanza() {
  const da = document.getElementById("fin-filtro-da").value;
  const a = document.getElementById("fin-filtro-a").value;
  const params = new URLSearchParams();
  if (da) params.set("da", da);
  if (a) params.set("a", a);
  const query = params.toString() ? `?${params}` : "";
  const spese = await apiGet(`/spese${query}`);
  if (tabellaSpese) tabellaSpese.setData(spese);
}

document.getElementById("form-spesa-finanza").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    data: document.getElementById("fin-data").value,
    importo: parseFloat(document.getElementById("fin-importo").value),
    valuta: document.getElementById("fin-valuta").value,
    categoria: document.getElementById("fin-categoria").value,
    descrizione: document.getElementById("fin-descrizione").value,
  };
  await apiSend("/spese", "POST", body);
  e.target.reset();
  caricaSpeseFinanza();
});

document.getElementById("btn-filtra-spese").addEventListener("click", caricaSpeseFinanza);

document.getElementById("btn-esporta-pdf").addEventListener("click", () => {
  if (!tabellaSpese) return;
  tabellaSpese.download("pdf", "expense-history.pdf", {
    orientation: "portrait",
    title: "Expense History - Nestly",
  });
});

document.getElementById("btn-esporta-excel").addEventListener("click", () => {
  if (!tabellaSpese) return;
  tabellaSpese.download("xlsx", "expense-history.xlsx", { sheetName: "Expenses" });
});

// ---- Convertitore NOK / EUR ----

let tassoEurNok = null;

async function caricaTassoCambio() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
    const dati = await res.json();
    tassoEurNok = dati.rates.NOK;
    document.getElementById("conv-tasso").textContent = `1 EUR = ${tassoEurNok.toFixed(4)} NOK`;
  } catch (err) {
    document.getElementById("conv-tasso").textContent = "Exchange rate unavailable";
  }
  aggiornaConvertitore();
}

function aggiornaConvertitore() {
  const risultatoEl = document.getElementById("conv-risultato");
  const importo = parseFloat(document.getElementById("conv-input").value);
  if (!tassoEurNok || isNaN(importo)) {
    risultatoEl.textContent = "—";
    return;
  }
  const direzione = document.getElementById("conv-valuta").value;
  let risultato, valutaOut;
  if (direzione === "NOK_EUR") {
    risultato = importo / tassoEurNok;
    valutaOut = "EUR";
  } else {
    risultato = importo * tassoEurNok;
    valutaOut = "NOK";
  }
  risultatoEl.textContent = `${risultato.toFixed(2)} ${valutaOut}`;
}

document.getElementById("conv-input").addEventListener("input", aggiornaConvertitore);
document.getElementById("conv-valuta").addEventListener("change", aggiornaConvertitore);

// ================= 7. ADMIN =================

async function caricaListaUtenti() {
  const cont = document.getElementById("lista-utenti");
  try {
    const utenti = await apiGet("/admin/users");
    cont.innerHTML = "";
    for (const u of utenti) {
      const div = document.createElement("div");
      div.className = "flex items-center justify-between border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm";
      const badge = u.role === "admin"
        ? '<span class="text-xs bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-full px-2 py-0.5">admin</span>'
        : '<span class="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-full px-2 py-0.5">user</span>';
      div.innerHTML = `
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-user text-slate-400"></i>
          <span class="font-medium">${u.username}</span>
          ${badge}
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-slate-400">${u.role === "admin" ? "all modules" : (u.allowed_modules.join(", ") || "no modules")}</span>
          <button class="btn-modifica-utente text-slate-400 hover:text-indigo-600"><i class="fa-solid fa-pen"></i></button>
        </div>
      `;
      div.querySelector(".btn-modifica-utente").addEventListener("click", () => apriModaleModifica(u));
      cont.appendChild(div);
    }
  } catch (err) {
    cont.innerHTML = `<p class="text-sm text-red-500">Error loading users</p>`;
  }
}

// ---- Modifica utente (modale) ----

const modaleEditUtente = document.getElementById("modal-edit-utente");

function apriModaleModifica(utente) {
  document.getElementById("eu-id").value = utente.id;
  document.getElementById("eu-username").value = utente.username;
  document.getElementById("eu-password").value = "";
  document.getElementById("eu-role").value = utente.role;
  document.getElementById("eu-errore").classList.add("hidden");
  renderModuliCheckbox(document.getElementById("eu-moduli"), utente.allowed_modules);
  modaleEditUtente.classList.remove("hidden");
  modaleEditUtente.classList.add("flex");
}

function chiudiModaleModifica() {
  modaleEditUtente.classList.add("hidden");
  modaleEditUtente.classList.remove("flex");
}

document.getElementById("eu-annulla").addEventListener("click", chiudiModaleModifica);
modaleEditUtente.addEventListener("click", (e) => {
  if (e.target === modaleEditUtente) chiudiModaleModifica();
});

document.getElementById("form-modifica-utente").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errore = document.getElementById("eu-errore");
  errore.classList.add("hidden");
  const id = document.getElementById("eu-id").value;
  const moduli = [...document.querySelectorAll("#eu-moduli input:checked")].map((c) => c.value);
  const body = {
    username: document.getElementById("eu-username").value,
    role: document.getElementById("eu-role").value,
    allowed_modules: moduli,
  };
  const password = document.getElementById("eu-password").value;
  if (password) body.password = password;
  try {
    await apiSend(`/admin/users/${id}`, "PUT", body);
    chiudiModaleModifica();
    caricaListaUtenti();
  } catch (err) {
    errore.textContent = "Error: username already in use or invalid data";
    errore.classList.remove("hidden");
  }
});

document.getElementById("form-nuovo-utente").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errore = document.getElementById("nu-errore");
  errore.classList.add("hidden");
  const moduli = [...document.querySelectorAll("#nu-moduli input:checked")].map((c) => c.value);
  const body = {
    username: document.getElementById("nu-username").value,
    password: document.getElementById("nu-password").value,
    role: document.getElementById("nu-role").value,
    allowed_modules: moduli,
  };
  try {
    await apiSend("/admin/users", "POST", body);
    e.target.reset();
    caricaListaUtenti();
  } catch (err) {
    errore.textContent = "Error: username already exists or invalid data";
    errore.classList.remove("hidden");
  }
});

// ================= 8. KANBAN (drag & drop) =================

function creaCardKanban(task) {
  const card = document.createElement("div");
  card.className = "kanban-card bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm shadow-sm cursor-move";
  card.draggable = true;
  card.dataset.id = task.id;
  card.innerHTML = `
    <div class="vista-kanban">
      <div class="flex items-start justify-between gap-2">
        <span class="font-medium">${task.title}</span>
        <div class="flex items-center gap-2 shrink-0">
          <button class="btn-edit-kanban text-slate-400 hover:text-indigo-600"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-del-kanban text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      ${task.description ? `<p class="text-xs text-slate-400 mt-1">${task.description}</p>` : ""}
    </div>
    <form class="edit-kanban hidden flex-col gap-1.5">
      <input type="text" class="edit-titolo border border-slate-300 dark:border-slate-700 dark:bg-slate-900 rounded px-2 py-1 text-sm" value="${task.title}" />
      <textarea class="edit-descrizione border border-slate-300 dark:border-slate-700 dark:bg-slate-900 rounded px-2 py-1 text-xs resize-none" rows="2">${task.description || ""}</textarea>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-annulla-kanban text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
        <button type="submit" class="text-emerald-600 hover:text-emerald-700"><i class="fa-solid fa-check"></i></button>
      </div>
    </form>
  `;
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(task.id));
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("opacity-40");
  });
  card.addEventListener("dragend", () => card.classList.remove("opacity-40"));
  card.querySelector(".btn-del-kanban").addEventListener("click", async () => {
    await apiSend(`/kanban/${task.id}`, "DELETE");
    caricaKanban();
  });

  const vista = card.querySelector(".vista-kanban");
  const editForm = card.querySelector(".edit-kanban");
  card.querySelector(".btn-edit-kanban").addEventListener("click", () => {
    vista.classList.add("hidden");
    editForm.classList.remove("hidden");
    editForm.classList.add("flex");
    card.draggable = false;
  });
  card.querySelector(".btn-annulla-kanban").addEventListener("click", () => {
    editForm.classList.add("hidden");
    editForm.classList.remove("flex");
    vista.classList.remove("hidden");
    card.draggable = true;
  });
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiSend(`/kanban/${task.id}`, "PATCH", {
      title: editForm.querySelector(".edit-titolo").value,
      description: editForm.querySelector(".edit-descrizione").value || null,
    });
    caricaKanban();
  });
  return card;
}

async function caricaKanban() {
  const tasks = await apiGet("/kanban");
  for (const stato of ["todo", "doing", "done"]) {
    const col = document.getElementById(`kanban-col-${stato}`);
    col.innerHTML = "";
    tasks.filter((t) => t.status === stato).forEach((t) => col.appendChild(creaCardKanban(t)));
  }
}

document.querySelectorAll(".kanban-dropzone").forEach((zone) => {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("bg-indigo-50", "dark:bg-indigo-950/40");
  });
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("bg-indigo-50", "dark:bg-indigo-950/40");
  });
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("bg-indigo-50", "dark:bg-indigo-950/40");
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    await apiSend(`/kanban/${taskId}`, "PUT", { status: zone.dataset.status });
    caricaKanban();
  });
});

document.getElementById("form-kanban").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    title: document.getElementById("kanban-titolo").value,
    description: document.getElementById("kanban-desc").value || null,
  };
  await apiSend("/kanban", "POST", body);
  e.target.reset();
  caricaKanban();
});

// ---- Todo list (dentro Kanban) ----

async function caricaTodo() {
  const items = await apiGet("/todo");
  const cont = document.getElementById("lista-todo");
  cont.innerHTML = "";
  if (items.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400 text-center py-2">List is empty</p>`;
    return;
  }
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "flex items-center gap-2 text-sm px-1 py-1";
    div.innerHTML = `
      <input type="checkbox" data-id="${it.id}" class="chk-todo w-4 h-4 accent-indigo-600" ${it.fatto ? "checked" : ""} />
      <span class="flex-1 ${it.fatto ? "line-through text-slate-400" : ""}">${it.testo}</span>
      <button data-id="${it.id}" class="btn-del-todo text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
    `;
    cont.appendChild(div);
  }
  cont.querySelectorAll(".chk-todo").forEach((chk) => {
    chk.addEventListener("change", async () => {
      await apiSend(`/todo/${chk.dataset.id}`, "PATCH");
      caricaTodo();
    });
  });
  cont.querySelectorAll(".btn-del-todo").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiSend(`/todo/${btn.dataset.id}`, "DELETE");
      caricaTodo();
    });
  });
}

document.getElementById("form-todo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const testo = document.getElementById("todo-testo").value;
  await apiSend("/todo", "POST", { testo });
  e.target.reset();
  caricaTodo();
});

// ================= 9. BUCKET LIST (condivisa) =================

async function caricaBucketList() {
  const items = await apiGet("/bucketlist");
  const cont = document.getElementById("lista-bucketlist");
  cont.innerHTML = "";
  if (items.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">No goals yet, add one!</p>`;
    return;
  }
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "flex items-center gap-2 text-sm px-1 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0";
    div.innerHTML = `
      <input type="checkbox" data-id="${it.id}" class="chk-bucket w-4 h-4 accent-indigo-600" ${it.is_completed ? "checked" : ""} />
      <span class="flex-1 ${it.is_completed ? "line-through text-slate-400" : ""}">${it.text}</span>
      <button data-id="${it.id}" class="btn-del-bucket text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
    `;
    cont.appendChild(div);
  }
  cont.querySelectorAll(".chk-bucket").forEach((chk) => {
    chk.addEventListener("change", async () => {
      await apiSend(`/bucketlist/${chk.dataset.id}`, "PATCH");
      caricaBucketList();
    });
  });
  cont.querySelectorAll(".btn-del-bucket").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiSend(`/bucketlist/${btn.dataset.id}`, "DELETE");
      caricaBucketList();
    });
  });
}

document.getElementById("form-bucketlist").addEventListener("submit", async (e) => {
  e.preventDefault();
  const testo = document.getElementById("bucketlist-testo").value;
  await apiSend("/bucketlist", "POST", { text: testo });
  e.target.reset();
  caricaBucketList();
});

// ================= 10. TRASPORTI (AtB / Entur) =================

const FERMATE_BUS = [
  { id: "NSR:StopPlace:42010", contenitore: "trasporti-valgrindvegen", lineeFiltrate: ["10", "18"] },
  { id: "NSR:StopPlace:42052", contenitore: "trasporti-valoyvegen", lineeFiltrate: null },
];

const QUERY_ENTUR = `
  query($id: String!, $n: Int!) {
    stopPlace(id: $id) {
      estimatedCalls(numberOfDepartures: $n) {
        expectedDepartureTime
        destinationDisplay { frontText }
        serviceJourney { line { publicCode } }
      }
    }
  }
`;

async function caricaFermataBus(fermata) {
  const cont = document.getElementById(fermata.contenitore);
  try {
    const res = await fetch("https://api.entur.io/journey-planner/v3/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ET-Client-Name": "nestly-app" },
      body: JSON.stringify({ query: QUERY_ENTUR, variables: { id: fermata.id, n: 20 } }),
    });
    const dati = await res.json();
    let partenze = dati?.data?.stopPlace?.estimatedCalls || [];
    if (fermata.lineeFiltrate) {
      partenze = partenze.filter((p) => fermata.lineeFiltrate.includes(p.serviceJourney.line.publicCode));
    }
    renderizzaPartenzeBus(cont, partenze.slice(0, 5));
  } catch (err) {
    cont.innerHTML = `<p class="text-sm text-red-500">Transport data unavailable right now</p>`;
  }
}

function renderizzaPartenzeBus(cont, partenze) {
  cont.innerHTML = "";
  if (partenze.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400">No upcoming departures</p>`;
    return;
  }
  const ora = new Date();
  for (const p of partenze) {
    const orarioPartenza = new Date(p.expectedDepartureTime);
    const minuti = Math.max(0, Math.round((orarioPartenza - ora) / 60000));
    const div = document.createElement("div");
    div.className = "flex items-center justify-between text-sm py-2 border-b border-slate-100 dark:border-slate-800 last:border-0";
    div.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="bg-indigo-600 text-white text-xs font-bold rounded px-1.5 py-0.5 min-w-[1.75rem] text-center">${p.serviceJourney.line.publicCode}</span>
        <span>${p.destinationDisplay.frontText}</span>
      </div>
      <span class="font-semibold ${minuti <= 2 ? "text-red-500" : "text-slate-500 dark:text-slate-400"}">${minuti === 0 ? "now" : minuti + " min"}</span>
    `;
    cont.appendChild(div);
  }
}

let intervalloTrasporti = null;

function avviaTrasporti() {
  FERMATE_BUS.forEach(caricaFermataBus);
  if (!intervalloTrasporti) {
    intervalloTrasporti = setInterval(() => FERMATE_BUS.forEach(caricaFermataBus), 30000);
  }
}

// ---- Aurora / Kp index (NOAA SWPC) ----

function classificaKp(kp) {
  if (kp >= 5) return { colore: "text-red-600 dark:text-red-400 border-red-400 bg-red-50 dark:bg-red-950", etichetta: "Storm" };
  if (kp >= 4) return { colore: "text-amber-600 dark:text-amber-400 border-amber-400 bg-amber-50 dark:bg-amber-950", etichetta: "Good" };
  if (kp >= 2) return { colore: "text-emerald-600 dark:text-emerald-400 border-emerald-400 bg-emerald-50 dark:bg-emerald-950", etichetta: "Possible" };
  return { colore: "text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600", etichetta: "Low" };
}

async function caricaKp() {
  const contAttuale = document.getElementById("kp-attuale");
  const contForecast = document.getElementById("kp-forecast");
  try {
    const [osservati, previsti] = await Promise.all([
      fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json").then((r) => r.json()),
      fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json").then((r) => r.json()),
    ]);

    const ultimo = osservati[osservati.length - 1];
    const stato = classificaKp(ultimo.Kp);
    contAttuale.innerHTML = `
      <div class="text-3xl font-bold px-4 py-2 rounded-xl border-2 ${stato.colore}">${ultimo.Kp.toFixed(1)}</div>
      <div>
        <p class="text-sm font-semibold ${stato.colore.split(" ")[0]}">${stato.etichetta}</p>
        <p class="text-xs text-slate-400">Current Kp</p>
      </div>
    `;

    const perGiorno = {};
    for (const riga of previsti) {
      if (riga.observed !== "predicted") continue;
      const giorno = riga.time_tag.slice(0, 10);
      perGiorno[giorno] = Math.max(perGiorno[giorno] || 0, riga.kp);
    }
    const giorni = Object.keys(perGiorno).sort().slice(0, 3);
    contForecast.innerHTML = "";
    for (const giorno of giorni) {
      const kpMax = perGiorno[giorno];
      const s = classificaKp(kpMax);
      const etichettaGiorno = new Date(`${giorno}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
      const div = document.createElement("div");
      div.className = "flex items-center justify-between text-sm";
      div.innerHTML = `
        <span class="text-slate-500 dark:text-slate-400">${etichettaGiorno}</span>
        <span class="font-semibold px-2 py-0.5 rounded border ${s.colore}">max ${kpMax.toFixed(1)}</span>
      `;
      contForecast.appendChild(div);
    }
  } catch (err) {
    contAttuale.innerHTML = `<p class="text-sm text-red-500">Aurora data unavailable right now</p>`;
  }
}

// ---- Weather & Daylight (Open-Meteo) ----

const TRONDHEIM_LAT = 63.4305;
const TRONDHEIM_LON = 10.3951;

const METEO_CODICI = {
  0: { icona: "fa-sun", etichetta: "Clear sky" },
  1: { icona: "fa-cloud-sun", etichetta: "Mainly clear" },
  2: { icona: "fa-cloud-sun", etichetta: "Partly cloudy" },
  3: { icona: "fa-cloud", etichetta: "Overcast" },
  45: { icona: "fa-smog", etichetta: "Fog" },
  48: { icona: "fa-smog", etichetta: "Fog" },
  51: { icona: "fa-cloud-rain", etichetta: "Drizzle" },
  53: { icona: "fa-cloud-rain", etichetta: "Drizzle" },
  55: { icona: "fa-cloud-rain", etichetta: "Drizzle" },
  61: { icona: "fa-cloud-showers-heavy", etichetta: "Rain" },
  63: { icona: "fa-cloud-showers-heavy", etichetta: "Rain" },
  65: { icona: "fa-cloud-showers-heavy", etichetta: "Heavy rain" },
  71: { icona: "fa-snowflake", etichetta: "Snow" },
  73: { icona: "fa-snowflake", etichetta: "Snow" },
  75: { icona: "fa-snowflake", etichetta: "Heavy snow" },
  80: { icona: "fa-cloud-showers-heavy", etichetta: "Showers" },
  81: { icona: "fa-cloud-showers-heavy", etichetta: "Showers" },
  82: { icona: "fa-cloud-showers-heavy", etichetta: "Violent showers" },
  85: { icona: "fa-snowflake", etichetta: "Snow showers" },
  86: { icona: "fa-snowflake", etichetta: "Snow showers" },
  95: { icona: "fa-bolt", etichetta: "Thunderstorm" },
  96: { icona: "fa-bolt", etichetta: "Thunderstorm" },
  99: { icona: "fa-bolt", etichetta: "Thunderstorm" },
};

function infoMeteo(codice) {
  return METEO_CODICI[codice] || { icona: "fa-cloud", etichetta: "—" };
}

async function caricaMeteo() {
  const contAttuale = document.getElementById("meteo-attuale");
  const contForecast = document.getElementById("meteo-forecast");
  const contLuce = document.getElementById("luce-diurna");
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${TRONDHEIM_LAT}&longitude=${TRONDHEIM_LON}&current=temperature_2m,weather_code,wind_speed_10m&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code&timezone=Europe%2FOslo&forecast_days=5`;
    const dati = await (await fetch(url)).json();

    const attuale = infoMeteo(dati.current.weather_code);
    contAttuale.innerHTML = `
      <div class="flex items-center gap-3">
        <i class="fa-solid ${attuale.icona} text-3xl text-indigo-600"></i>
        <div>
          <p class="text-2xl font-bold">${Math.round(dati.current.temperature_2m)}°C</p>
          <p class="text-xs text-slate-400">${attuale.etichetta} · ${Math.round(dati.current.wind_speed_10m)} km/h wind</p>
        </div>
      </div>
    `;

    contForecast.innerHTML = "";
    for (let i = 1; i < dati.daily.time.length; i++) {
      const info = infoMeteo(dati.daily.weather_code[i]);
      const etichettaGiorno = new Date(`${dati.daily.time[i]}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
      const div = document.createElement("div");
      div.className = "flex items-center justify-between text-sm";
      div.innerHTML = `
        <span class="text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><i class="fa-solid ${info.icona} text-indigo-500 w-4 text-center"></i> ${etichettaGiorno}</span>
        <span>${Math.round(dati.daily.temperature_2m_max[i])}° / ${Math.round(dati.daily.temperature_2m_min[i])}°</span>
      `;
      contForecast.appendChild(div);
    }

    const alba = new Date(dati.daily.sunrise[0]);
    const tramonto = new Date(dati.daily.sunset[0]);
    const minutiLuce = Math.round((tramonto - alba) / 60000);
    const oreLuce = Math.floor(minutiLuce / 60);
    const minutiRestanti = minutiLuce % 60;

    const albaDomani = new Date(dati.daily.sunrise[1]);
    const tramontoDomani = new Date(dati.daily.sunset[1]);
    const minutiLuceDomani = Math.round((tramontoDomani - albaDomani) / 60000);
    const delta = minutiLuceDomani - minutiLuce;
    const trend = delta === 0 ? "same as tomorrow" : delta > 0 ? `+${delta} min tomorrow` : `${delta} min tomorrow`;

    const formattaOra = (d) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    contLuce.innerHTML = `
      <div class="flex items-center justify-between text-sm mb-2">
        <span class="text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><i class="fa-solid fa-arrow-up text-amber-500"></i> Sunrise</span>
        <span class="font-semibold">${formattaOra(alba)}</span>
      </div>
      <div class="flex items-center justify-between text-sm mb-3">
        <span class="text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><i class="fa-solid fa-arrow-down text-indigo-500"></i> Sunset</span>
        <span class="font-semibold">${formattaOra(tramonto)}</span>
      </div>
      <p class="text-xs text-slate-400">${oreLuce}h ${minutiRestanti}m of daylight (${trend})</p>
    `;
  } catch (err) {
    contAttuale.innerHTML = `<p class="text-sm text-red-500">Weather data unavailable right now</p>`;
    contLuce.innerHTML = "";
  }
}

// ================= 11. SEGNALIBRI & RISORSE =================

async function caricaBookmark() {
  const bookmark = await apiGet("/bookmarks");
  const cont = document.getElementById("lista-bookmark");
  cont.innerHTML = "";

  const datalist = document.getElementById("bk-categorie-esistenti");
  datalist.innerHTML = [...new Set(bookmark.map((b) => b.category))]
    .map((c) => `<option value="${c}"></option>`).join("");

  if (bookmark.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">No bookmarks saved</p>`;
    return;
  }

  const gruppi = {};
  for (const b of bookmark) {
    (gruppi[b.category] ||= []).push(b);
  }

  for (const [categoria, items] of Object.entries(gruppi)) {
    const blocco = document.createElement("div");
    blocco.className = "bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5";
    blocco.innerHTML = `
      <h2 class="text-sm font-semibold mb-3 text-slate-500 dark:text-slate-400 uppercase tracking-wide">${categoria}</h2>
      <div class="space-y-1"></div>
    `;
    const lista = blocco.querySelector("div.space-y-1");
    for (const b of items) {
      const riga = document.createElement("div");
      riga.className = "flex items-center justify-between gap-2 text-sm py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0";
      riga.innerHTML = `
        <a href="${b.url}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 hover:underline truncate">
          <i class="fa-solid fa-arrow-up-right-from-square shrink-0"></i> <span class="truncate">${b.title}</span>
        </a>
        <button data-id="${b.id}" class="btn-del-bookmark text-slate-400 hover:text-red-500 shrink-0"><i class="fa-solid fa-xmark"></i></button>
      `;
      lista.appendChild(riga);
    }
    cont.appendChild(blocco);
  }

  cont.querySelectorAll(".btn-del-bookmark").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiSend(`/bookmarks/${btn.dataset.id}`, "DELETE");
      caricaBookmark();
    });
  });
}

document.getElementById("form-bookmark").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    title: document.getElementById("bk-title").value,
    url: document.getElementById("bk-url").value,
    category: document.getElementById("bk-category").value,
  };
  await apiSend("/bookmarks", "POST", body);
  e.target.reset();
  caricaBookmark();
});

// ================= 12. CUCINA & MEAL PLAN =================

async function caricaAntiSpreco() {
  const cont = document.getElementById("allerta-antispreco");
  const items = await apiGet("/frigo");
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  const inScadenza = items.filter((it) => {
    if (!it.scadenza) return false;
    const giorni = Math.round((new Date(it.scadenza) - oggi) / 86400000);
    return giorni <= 3;
  });

  cont.innerHTML = "";
  if (inScadenza.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400 col-span-full">No food items expiring in the next 3 days.</p>`;
    return;
  }
  for (const it of inScadenza) {
    const giorni = Math.round((new Date(it.scadenza) - oggi) / 86400000);
    const etichetta = giorni < 0 ? "Expired" : giorni === 0 ? "Expires today" : `Expires in ${giorni}d`;
    const div = document.createElement("div");
    div.className = "flex items-center justify-between gap-2 text-sm rounded-lg border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-3 py-2";
    div.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-triangle-exclamation text-red-500"></i>
        <span class="font-medium">${it.nome}</span>
        <span class="text-slate-400">× ${it.quantita}</span>
      </div>
      <span class="text-xs font-semibold text-red-600 dark:text-red-400">${etichetta}</span>
    `;
    cont.appendChild(div);
  }
}

const GIORNI_SETTIMANA = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isoData(d) {
  return d.toISOString().slice(0, 10);
}

async function caricaGrigliaMealPlan() {
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  const fine = new Date(oggi);
  fine.setDate(fine.getDate() + 6);

  const voci = await apiGet(`/mealplan?da=${isoData(oggi)}&a=${isoData(fine)}`);
  const mappaVoci = {};
  for (const v of voci) mappaVoci[`${v.data}_${v.meal_type}`] = v;

  const cont = document.getElementById("griglia-mealplan");
  cont.innerHTML = "";

  for (let i = 0; i < 7; i++) {
    const giorno = new Date(oggi);
    giorno.setDate(giorno.getDate() + i);
    const dataIso = isoData(giorno);
    const card = document.createElement("div");
    card.className = "bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-4 space-y-3";
    card.innerHTML = `
      <div>
        <p class="font-semibold text-sm">${GIORNI_SETTIMANA[giorno.getDay()]}</p>
        <p class="text-xs text-slate-400">${formattaData(dataIso)}</p>
      </div>
      <div>
        <label class="text-xs text-slate-400 flex items-center gap-1 mb-1"><i class="fa-solid fa-sun text-amber-500"></i> Lunch</label>
        <textarea data-data="${dataIso}" data-tipo="Pranzo" rows="2" class="mp-input w-full text-sm border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-2 py-1.5 resize-none">${mappaVoci[`${dataIso}_Pranzo`]?.recipe || ""}</textarea>
      </div>
      <div>
        <label class="text-xs text-slate-400 flex items-center gap-1 mb-1"><i class="fa-solid fa-moon text-indigo-500"></i> Dinner</label>
        <textarea data-data="${dataIso}" data-tipo="Cena" rows="2" class="mp-input w-full text-sm border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-2 py-1.5 resize-none">${mappaVoci[`${dataIso}_Cena`]?.recipe || ""}</textarea>
      </div>
    `;
    cont.appendChild(card);
  }

  cont.querySelectorAll(".mp-input").forEach((area) => {
    area.addEventListener("blur", async () => {
      const testo = area.value.trim();
      const chiave = `${area.dataset.data}_${area.dataset.tipo}`;
      const esistente = mappaVoci[chiave];
      if (!testo) {
        if (esistente) {
          await apiSend(`/mealplan/${esistente.id}`, "DELETE");
          delete mappaVoci[chiave];
        }
        return;
      }
      const salvato = await apiSend("/mealplan", "POST", {
        data: area.dataset.data,
        meal_type: area.dataset.tipo,
        recipe: testo,
      });
      mappaVoci[chiave] = salvato;
    });
  });
}

// ================= 13. PULIZIE (chore rotation) =================

let pulizieRoommateCache = [];

async function caricaPulizie() {
  await caricaPulizieRoommate();
  await Promise.all([caricaPulizieSettimane(), caricaPulizieSwapRichieste(), caricaPulizieStats()]);
}

async function caricaPulizieRoommate() {
  pulizieRoommateCache = await apiGet("/pulizie/roommate");
  if (currentUser.role === "admin") {
    document.getElementById("pulizie-admin").classList.remove("hidden");
    await renderPulizieAdmin();
  }
}

async function renderPulizieAdmin() {
  const cont = document.getElementById("pulizie-roommate-lista");
  cont.innerHTML = "";
  pulizieRoommateCache.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "flex items-center gap-2 text-sm px-1 py-1";
    div.innerHTML = `
      <span class="w-5 text-slate-400">${i + 1}.</span>
      <span class="flex-1">${r.username}</span>
      <button data-idx="${i}" class="btn-pulizie-su text-slate-400 hover:text-indigo-600" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
      <button data-idx="${i}" class="btn-pulizie-giu text-slate-400 hover:text-indigo-600" ${i === pulizieRoommateCache.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
      <button data-idx="${i}" class="btn-pulizie-rimuovi text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
    `;
    cont.appendChild(div);
  });
  cont.querySelectorAll(".btn-pulizie-su").forEach((b) => b.addEventListener("click", () => spostaPulizieRoommate(Number(b.dataset.idx), -1)));
  cont.querySelectorAll(".btn-pulizie-giu").forEach((b) => b.addEventListener("click", () => spostaPulizieRoommate(Number(b.dataset.idx), 1)));
  cont.querySelectorAll(".btn-pulizie-rimuovi").forEach((b) => b.addEventListener("click", () => rimuoviPulizieRoommate(Number(b.dataset.idx))));

  const tutti = await apiGet("/admin/users");
  const select = document.getElementById("pulizie-nuovo-roommate");
  const inRotazione = new Set(pulizieRoommateCache.map((r) => r.user_id));
  select.innerHTML = tutti
    .filter((u) => !inRotazione.has(u.id))
    .map((u) => `<option value="${u.id}">${u.username}</option>`)
    .join("");
}

async function salvaOrdinePulizieRoommate() {
  const user_ids = pulizieRoommateCache.map((r) => r.user_id);
  pulizieRoommateCache = await apiSend("/pulizie/roommate", "PUT", { user_ids });
  await renderPulizieAdmin();
}

function spostaPulizieRoommate(indice, direzione) {
  const nuovoIndice = indice + direzione;
  if (nuovoIndice < 0 || nuovoIndice >= pulizieRoommateCache.length) return;
  const [riga] = pulizieRoommateCache.splice(indice, 1);
  pulizieRoommateCache.splice(nuovoIndice, 0, riga);
  salvaOrdinePulizieRoommate();
}

function rimuoviPulizieRoommate(indice) {
  pulizieRoommateCache.splice(indice, 1);
  salvaOrdinePulizieRoommate();
}

document.getElementById("pulizie-aggiungi-roommate").addEventListener("click", () => {
  const select = document.getElementById("pulizie-nuovo-roommate");
  if (!select.value) return;
  pulizieRoommateCache.push({
    user_id: Number(select.value),
    username: select.options[select.selectedIndex].textContent,
    ordine: pulizieRoommateCache.length,
  });
  salvaOrdinePulizieRoommate();
});

async function caricaPulizieSettimane() {
  const settimane = await apiGet("/pulizie/settimane?settimane=6");
  const corrente = settimane[0];
  const contCorrente = document.getElementById("pulizie-turno-corrente");
  if (!corrente) {
    contCorrente.innerHTML = `<p class="text-sm text-slate-400">No roommates configured yet.</p>`;
    document.getElementById("pulizie-settimane").innerHTML = "";
    return;
  }
  const mioTurno = corrente.assegnato_username === currentUser.username;
  contCorrente.innerHTML = `
    <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
      <i class="fa-solid fa-broom text-indigo-600"></i> This Week
    </h2>
    <p class="text-sm mb-3">${corrente.assegnato_username} is on cleaning duty ${corrente.completato ? '<span class="text-emerald-600">(done)</span>' : ""}</p>
    <div class="flex gap-2">
      ${mioTurno && !corrente.completato ? `<button id="btn-pulizie-completa" class="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition"><i class="fa-solid fa-check"></i> Mark done</button>` : ""}
      ${mioTurno && !corrente.completato && !corrente.richiesta_pendente ? `<button id="btn-pulizie-swap" class="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg px-4 py-2 text-sm font-medium transition"><i class="fa-solid fa-right-left"></i> Request swap</button>` : ""}
    </div>
    ${corrente.richiesta_pendente ? `<p class="text-xs text-slate-400 mt-2">Swap requested to ${corrente.richiesta_pendente.target_username} — pending</p>` : ""}
  `;
  document.getElementById("btn-pulizie-completa")?.addEventListener("click", async () => {
    try {
      await apiSend(`/pulizie/settimane/${corrente.settimana_idx}/completa`, "POST");
      caricaPulizie();
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById("btn-pulizie-swap")?.addEventListener("click", () => apriModalePulizieSwap(corrente.settimana_idx));

  const cont = document.getElementById("pulizie-settimane");
  cont.innerHTML = "";
  for (const s of settimane.slice(1)) {
    const div = document.createElement("div");
    div.className = "flex items-center justify-between text-sm px-1 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0";
    div.innerHTML = `<span>${formattaData(s.inizio)}</span><span class="font-medium">${s.assegnato_username}</span>`;
    cont.appendChild(div);
  }
}

function apriModalePulizieSwap(settimana_idx) {
  document.getElementById("pulizie-swap-settimana").value = settimana_idx;
  const select = document.getElementById("pulizie-swap-target");
  select.innerHTML = pulizieRoommateCache
    .filter((r) => r.username !== currentUser.username)
    .map((r) => `<option value="${r.user_id}">${r.username}</option>`)
    .join("");
  document.getElementById("modal-pulizie-swap").classList.remove("hidden");
  document.getElementById("modal-pulizie-swap").classList.add("flex");
}

function chiudiModalePulizieSwap() {
  document.getElementById("modal-pulizie-swap").classList.add("hidden");
  document.getElementById("modal-pulizie-swap").classList.remove("flex");
}

document.getElementById("pulizie-swap-chiudi").addEventListener("click", chiudiModalePulizieSwap);

document.getElementById("form-pulizie-swap").addEventListener("submit", async (e) => {
  e.preventDefault();
  const settimana_idx = Number(document.getElementById("pulizie-swap-settimana").value);
  const target_id = Number(document.getElementById("pulizie-swap-target").value);
  try {
    await apiSend("/pulizie/swap", "POST", { settimana_idx, target_id });
    chiudiModalePulizieSwap();
    caricaPulizie();
  } catch (err) {
    alert(err.message);
  }
});

async function caricaPulizieSwapRichieste() {
  const richieste = await apiGet("/pulizie/swap/mie");
  const cont = document.getElementById("pulizie-swap-richieste");
  cont.innerHTML = "";
  if (richieste.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400">No pending swap requests.</p>`;
    return;
  }
  for (const r of richieste) {
    const inArrivo = r.target_username === currentUser.username;
    const div = document.createElement("div");
    div.className = "flex items-center justify-between gap-2 text-sm px-1 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0";
    div.innerHTML = `
      <span>${formattaData(r.inizio)} — ${inArrivo ? `${r.richiedente_username} wants you to cover their turn` : `Waiting for ${r.target_username} to respond`}</span>
      <div class="flex gap-2 shrink-0">
        ${inArrivo
          ? `<button data-id="${r.id}" class="btn-pulizie-swap-accetta text-emerald-600 hover:text-emerald-700"><i class="fa-solid fa-check"></i></button>
             <button data-id="${r.id}" class="btn-pulizie-swap-rifiuta text-red-500 hover:text-red-600"><i class="fa-solid fa-xmark"></i></button>`
          : `<button data-id="${r.id}" class="btn-pulizie-swap-annulla text-slate-400 hover:text-red-500"><i class="fa-solid fa-ban"></i></button>`}
      </div>
    `;
    cont.appendChild(div);
  }
  cont.querySelectorAll(".btn-pulizie-swap-accetta").forEach((b) => b.addEventListener("click", async () => {
    try {
      await apiSend(`/pulizie/swap/${b.dataset.id}/accetta`, "POST");
      caricaPulizie();
    } catch (err) {
      alert(err.message);
    }
  }));
  cont.querySelectorAll(".btn-pulizie-swap-rifiuta").forEach((b) => b.addEventListener("click", async () => {
    try {
      await apiSend(`/pulizie/swap/${b.dataset.id}/rifiuta`, "POST");
      caricaPulizie();
    } catch (err) {
      alert(err.message);
    }
  }));
  cont.querySelectorAll(".btn-pulizie-swap-annulla").forEach((b) => b.addEventListener("click", async () => { await apiSend(`/pulizie/swap/${b.dataset.id}/annulla`, "POST"); caricaPulizie(); }));
}

async function caricaPulizieStats() {
  const stats = await apiGet("/pulizie/stats");
  const cont = document.getElementById("pulizie-stats");
  cont.innerHTML = "";
  if (stats.length === 0) {
    cont.innerHTML = `<p class="text-slate-400">No data yet.</p>`;
    return;
  }
  for (const s of stats) {
    const div = document.createElement("div");
    div.className = "flex items-center justify-between px-1 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0";
    div.innerHTML = `<span class="font-medium">${s.username}</span><span class="text-slate-500">${s.turni_completati}/${s.turni_assegnati_totali} done · ${s.swap_accettati_dati} swaps given · ${s.swap_accettati_ricevuti} swaps received</span>`;
    cont.appendChild(div);
  }
}
