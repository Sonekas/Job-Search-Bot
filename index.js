const { Client, LocalAuth } = require("whatsapp-web.js");
const http = require("http");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode");
const { getConfig } = require("./config");
const { extractText } = require("./parser");
const { isRelevantMessage } = require("./filters");
const { forwardWithDelay } = require("./forwarder");
const { appendLog } = require("./storage");

let config = getConfig();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "bot-filtro-vagas" }),
  puppeteer: {
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

let lifecyclePromise = Promise.resolve();

const state = {
  monitoredGroups: new Set(),
  monitoredChatsByName: new Map(),
  destinationChat: null,
  availableGroups: [],
  qrDataUrl: null,
  qrUpdatedAt: null,
  readingEnabled: false,
  connectionStatus: "Aguardando QR Code",
  lastEvent: null,
  lastEventAt: null,
  lastError: null,
  isProcessing: false,
  currentGroup: null,
  isSyncing: false,
  lastSyncAt: null,
  lastSyncError: null,
  uiStep: "qr",
  runtimeEvents: [],
  readingCompleted: false,
};

const normalizeName = (name) => name.trim().toLowerCase();

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const listToString = (list) => list.join(", ");

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const randomDelay = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const delayBetweenGroups = async () => {
  const minMs = Math.max(0, Math.round(config.delaySeconds.min * 1000));
  const maxMs = Math.max(0, Math.round(config.delaySeconds.max * 1000));
  await sleep(randomDelay(minMs, maxMs));
};

const runLifecycle = (task) => {
  lifecyclePromise = lifecyclePromise
    .then(task)
    .catch((error) => {
      updateConnection("Erro no ciclo de conexão", "lifecycle_error", error);
    });
  return lifecyclePromise;
};

const safeDestroy = async (origin) => {
  updateConnection("Encerrando sessão", origin || "destroy");
  try {
    await client.destroy();
  } catch (error) {
    updateConnection("Erro ao encerrar sessão", "destroy_error", error);
  }
  await sleep(500);
};

const safeInitialize = async (origin) => {
  updateConnection("Iniciando sessão", origin || "initialize");
  try {
    await client.initialize();
  } catch (error) {
    updateConnection("Erro ao iniciar sessão", "initialize_error", error);
  }
};

const removeAuthDir = async (authPath) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.promises.rm(authPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await sleep(300);
    }
  }
};

const updateConnection = (status, event, error) => {
  if (status) state.connectionStatus = status;
  if (event) state.lastEvent = event;
  state.lastEventAt = Date.now();
  if (status) {
    state.runtimeEvents.push({
      time: new Date().toLocaleTimeString(),
      message: status,
    });
    if (state.runtimeEvents.length > 50) {
      state.runtimeEvents.shift();
    }
  }
  if (error) {
    state.lastError =
      typeof error === "string" ? error : error.message || String(error);
  }
};

const clearConnectionError = () => {
  state.lastError = null;
};

const applyEnvValues = (values) => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const writeEnvFile = async (values) => {
  const lines = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  const envPath = path.join(__dirname, ".env");
  await fs.promises.writeFile(envPath, `${lines.join("\n")}\n`, "utf8");
};

const getGroupChatByName = (chats, targetName) => {
  const normalizedTarget = normalizeName(targetName);
  return chats.find(
    (chat) =>
      chat.isGroup && normalizeName(chat.name) === normalizedTarget
  );
};

const buildMonitoringIndex = (chats) => {
  state.monitoredGroups = new Set(
    config.monitoredGroups.map((name) => normalizeName(name))
  );
  state.monitoredChatsByName = new Map();
  state.availableGroups = chats
    .filter((chat) => chat.isGroup)
    .map((chat) => chat.name)
    .sort((a, b) => a.localeCompare(b));

  for (const chat of chats) {
    if (!chat.isGroup) continue;
    const normalized = normalizeName(chat.name);
    if (state.monitoredGroups.has(normalized)) {
      state.monitoredChatsByName.set(normalized, chat);
    }
  }
};

const handleMessage = async (message, originChat, destinationChat) => {
  if (!state.readingEnabled) return;
  if (!destinationChat) return;
  if (message.fromMe) return;

  const text = extractText(message);
  const approved = isRelevantMessage(text, config);
  if (!approved) return;

  await forwardWithDelay(message, destinationChat, config);
  await appendLog(
    {
      grupo_origem: originChat.name,
      grupo_destino: destinationChat.name,
      tamanho_mensagem: text.length,
      data: new Date(message.timestamp * 1000).toISOString(),
      aprovado_filtro: true,
    },
    config
  );
};

const processUnreadMessages = async () => {
  if (state.isProcessing) return;
  state.isProcessing = true;
  try {
    for (const [, chat] of state.monitoredChatsByName) {
      if (!chat.unreadCount || chat.unreadCount <= 0) continue;
      state.currentGroup = chat.name;

      const messages = await chat.fetchMessages({
        limit: chat.unreadCount,
      });

      const ordered = [...messages].sort(
        (a, b) => a.timestamp - b.timestamp
      );

      for (const message of ordered) {
        await handleMessage(message, chat, state.destinationChat);
      }

      await delayBetweenGroups();
    }
    if (state.readingEnabled) {
      state.readingEnabled = false;
      state.readingCompleted = true;
      setUiStep("config");
      updateConnection("Leitura finalizada. Deseja iniciar novamente?", "reading_done");
    }
  } finally {
    state.currentGroup = null;
    state.isProcessing = false;
  }
};

let isClientReady = false;

const syncGroups = async () => {
  if (!isClientReady) return;
  if (state.isSyncing) return;
  state.isSyncing = true;
  state.lastSyncError = null;
  updateConnection("Sincronizando grupos", "sync_groups");
  try {
    const chats = await client.getChats();
    state.destinationChat = getGroupChatByName(
      chats,
      config.destinationGroup
    );
    buildMonitoringIndex(chats);
    state.lastSyncAt = Date.now();
    updateConnection("Grupos sincronizados", "sync_groups_done");
  } catch (error) {
    state.lastSyncError = error.message || String(error);
    updateConnection("Erro ao sincronizar grupos", "sync_groups_error", error);
  } finally {
    state.isSyncing = false;
  }
};

const refreshMonitoring = async () => {
  await syncGroups();
};

const setUiStep = (nextStep) => {
  state.uiStep = nextStep;
};

const getStatusText = () => {
  if (state.uiStep === "qr") {
    return state.connectionStatus || "Aguardando QR Code";
  }
  if (state.uiStep === "config") {
    if (state.isSyncing) return "Sincronizando grupos";
    return "Aguardando configuração";
  }
  if (state.uiStep === "runtime") {
    if (state.isProcessing) return "Processando mensagens";
    if (!state.readingEnabled) return "Leitura pausada";
    return "Aguardando mensagens";
  }
  return state.connectionStatus || "Aguardando";
};

const renderForm = () => {
  const groups = escapeHtml(listToString(config.monitoredGroups));
  const destinations = escapeHtml(config.destinationGroup);
  const locations = escapeHtml(listToString(config.locationKeywords));
  const areas = escapeHtml(listToString(config.areaKeywords));
  const delayMin = escapeHtml(config.delaySeconds.min);
  const delayMax = escapeHtml(config.delaySeconds.max);
  const statusText = getStatusText();
  const groupOptions = state.availableGroups.length
    ? state.availableGroups
        .map((group) => {
          const normalized = normalizeName(group);
          const checked = state.monitoredGroups.has(normalized)
            ? "checked"
            : "";
          return `<label class="chip"><input type="checkbox" name="monitoredGroups" value="${escapeHtml(
            group
          )}" ${checked} />${escapeHtml(group)}</label>`;
        })
        .join("")
    : "";
  const destinationOptions = state.availableGroups.length
    ? state.availableGroups
        .map((group) => {
          const selected =
            normalizeName(group) === normalizeName(config.destinationGroup)
              ? "selected"
              : "";
          return `<option value="${escapeHtml(group)}" ${selected}>${escapeHtml(
            group
          )}</option>`;
        })
        .join("")
    : `<option value="${destinations}">${destinations}</option>`;
  const qrSection = state.qrDataUrl
    ? `<div class="qr">
        <img src="${state.qrDataUrl}" alt="QR Code" />
        <p>Escaneie o QR Code com o WhatsApp</p>
      </div>`
    : `<div class="qr placeholder">
        <div class="qr-box"></div>
        <p>Gerando QR Code...</p>
      </div>`;
  const qrUpdatedText = state.qrUpdatedAt
    ? `Última atualização: ${new Date(state.qrUpdatedAt).toLocaleTimeString()}`
    : "";
  const connectionText = escapeHtml(state.connectionStatus || "");
  const lastEventText = state.lastEvent
    ? `${escapeHtml(state.lastEvent)} · ${new Date(
        state.lastEventAt
      ).toLocaleTimeString()}`
    : "Sem eventos";
  const lastErrorText = state.lastError
    ? escapeHtml(state.lastError)
    : "Nenhum erro";
  const currentGroupText = state.currentGroup
    ? escapeHtml(state.currentGroup)
    : "Nenhum";
  const syncText = state.isSyncing
    ? "Sincronizando..."
    : state.lastSyncAt
      ? `Última sincronização: ${new Date(
          state.lastSyncAt
        ).toLocaleTimeString()}`
      : "Sem sincronização";
  const syncErrorText = state.lastSyncError
    ? escapeHtml(state.lastSyncError)
    : "Nenhum erro";

  const qrCardStyle = state.uiStep === "qr" ? "" : "style=\"display:none;\"";
  const configCardStyle =
    state.uiStep === "config" ? "" : "style=\"display:none;\"";
  const runtimeCardStyle =
    state.uiStep === "runtime" ? "" : "style=\"display:none;\"";
  const runtimeLines = state.runtimeEvents
    .map((entry) => `<div class="log-line">${escapeHtml(entry.time)} · ${escapeHtml(entry.message)}</div>`)
    .join("") || "<div class=\"muted\">Sem eventos ainda.</div>";

  return `<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Configuração do Bot</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
        background: #f5f6fb;
        color: #1f2430;
      }
      body { margin: 0; padding: 32px; }
      .container { max-width: 980px; margin: 0 auto; display: grid; gap: 20px; }
      .card { background: #fff; border-radius: 14px; padding: 22px; box-shadow: 0 10px 30px rgba(31, 36, 48, 0.08); border: 1px solid #eef0f6; }
      .title { font-size: 22px; font-weight: 700; margin: 0; }
      .status { display: flex; align-items: center; gap: 12px; font-weight: 600; }
      .status .dot { width: 10px; height: 10px; border-radius: 999px; background: #f5a623; }
      .status.ready .dot { background: #17c964; }
      label { display: block; margin-top: 16px; font-weight: 600; }
      input, textarea, select { width: 100%; padding: 10px; margin-top: 6px; border-radius: 8px; border: 1px solid #d6d9e0; font-size: 14px; }
      button { margin-top: 20px; padding: 10px 16px; border-radius: 10px; border: none; background: #2563eb; color: #fff; font-weight: 600; cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease; }
      button:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(37, 99, 235, 0.25); }
      button.secondary { background: #eef2ff; color: #1f2937; margin-left: 10px; }
      .row { display: flex; gap: 12px; }
      .row > div { flex: 1; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; max-height: 240px; overflow: auto; padding: 6px; border: 1px solid #eef0f6; border-radius: 10px; background: #fbfcff; }
      .chip { display: inline-flex; gap: 6px; align-items: center; padding: 6px 10px; border-radius: 999px; border: 1px solid #d6d9e0; background: #f8fafc; font-size: 13px; }
      .search { margin-top: 12px; }
      .muted { color: #6b7280; font-size: 13px; margin-top: 8px; }
      .qr { display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .qr img { width: 220px; height: 220px; border-radius: 12px; border: 1px solid #e5e7eb; }
      .qr.placeholder { color: #6b7280; }
      .qr-box { width: 220px; height: 220px; border-radius: 12px; border: 1px dashed #cbd5f5; background: #f0f4ff; }
      .diagnostic { display: grid; gap: 8px; }
      .diagnostic strong { font-weight: 600; }
      .log { display: grid; gap: 8px; max-height: 280px; overflow: auto; padding: 12px; border-radius: 10px; border: 1px solid #eef0f6; background: #fbfcff; font-size: 13px; }
      .log-line { display: block; }
      .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <div class="status ${isClientReady ? "ready" : ""}">
          <span class="dot"></span>
          <span id="statusText">${statusText}</span>
        </div>
      </div>

      <div class="card" id="qrSection" ${qrCardStyle}>
        ${qrSection}
        <div class="muted" id="qrUpdated">${qrUpdatedText}</div>
        <div class="actions">
          <button type="button" class="secondary" id="restartButton">Reiniciar conexão</button>
          <button type="button" class="secondary" id="clearSessionButton">Limpar sessão</button>
        </div>
      </div>

      <div class="card" id="configSection" ${configCardStyle}>
        <h1 class="title">Configuração do Bot</h1>
        <div class="muted" id="readingDoneNotice" style="display:${state.readingCompleted ? "block" : "none"};">
          Leitura finalizada. Deseja iniciar novamente?
        </div>
        <form method="POST" action="/save">
          <label>Grupos monitorados</label>
          <div class="actions">
            <button type="button" class="secondary" id="syncGroupsButton">Sincronizar grupos</button>
          </div>
          <input class="search" id="groupSearch" placeholder="Pesquisar grupos..." />
          <div class="chips" id="groupsList">${groupOptions || "Conecte o WhatsApp para listar grupos."}</div>
          <div class="muted" id="groupCount"></div>
          <textarea name="monitoredGroupsText" rows="2" placeholder="Ou cole aqui separados por vírgula">${groups}</textarea>

          <label>Grupo destino</label>
          <select name="destinationGroup" id="destinationSelect">${destinationOptions}</select>

          <label>Palavras-chave de localização</label>
          <textarea name="locationKeywords" rows="3">${locations}</textarea>

          <label>Palavras-chave da área profissional</label>
          <textarea name="areaKeywords" rows="3">${areas}</textarea>

          <div class="row">
            <div>
              <label>Delay mínimo (segundos)</label>
              <input name="delayMinSec" value="${delayMin}" />
            </div>
            <div>
              <label>Delay máximo (segundos)</label>
              <input name="delayMaxSec" value="${delayMax}" />
            </div>
          </div>

          <div class="actions">
            <button type="submit">Salvar configuração</button>
            <button type="button" class="secondary" id="startButton">Iniciar leitura</button>
          </div>
        </form>
      </div>

      <div class="card" id="runtimeSection" ${runtimeCardStyle}>
        <h2 class="title">Execução</h2>
        <div class="muted">Logs em tempo real do que está acontecendo</div>
        <div class="log" id="runtimeLog">
          ${runtimeLines}
        </div>
        <div class="diagnostic">
          <div><strong>Status:</strong> <span id="connectionStatus">${connectionText}</span></div>
          <div><strong>Último evento:</strong> <span id="lastEvent">${lastEventText}</span></div>
          <div><strong>Erro:</strong> <span id="lastError">${lastErrorText}</span></div>
          <div><strong>Grupo em processamento:</strong> <span id="currentGroup">${currentGroupText}</span></div>
          <div><strong>Sincronização:</strong> <span id="syncStatus">${syncText}</span></div>
          <div><strong>Erro de sincronização:</strong> <span id="syncError">${syncErrorText}</span></div>
        </div>
      </div>
    </div>
    <script>
      const startButton = document.getElementById("startButton");
      const restartButton = document.getElementById("restartButton");
      const clearSessionButton = document.getElementById("clearSessionButton");
      const syncGroupsButton = document.getElementById("syncGroupsButton");
      const groupSearch = document.getElementById("groupSearch");
      const groupCount = document.getElementById("groupCount");
      startButton.addEventListener("click", async () => {
        await fetch("/start", { method: "POST" });
        await refreshStatus();
      });
      restartButton.addEventListener("click", async () => {
        await fetch("/restart", { method: "POST" });
        await refreshStatus();
      });
      clearSessionButton.addEventListener("click", async () => {
        await fetch("/clear-session", { method: "POST" });
        await refreshStatus();
      });
      syncGroupsButton.addEventListener("click", async () => {
        await fetch("/sync-groups", { method: "POST" });
        await refreshStatus();
      });

      groupSearch.addEventListener("input", () => {
        filterGroups();
      });

      function getSelectedGroups() {
        return Array.from(
          document.querySelectorAll('#groupsList input[name="monitoredGroups"]:checked')
        ).map((input) => input.value.toLowerCase());
      }

      function getSelectedDestination() {
        return (destinationSelect.value || "").toLowerCase();
      }

      function normalize(value) {
        return value
          .toLowerCase()
          .normalize("NFD")
          .replace(/\\p{Diacritic}/gu, "");
      }

      function filterGroups() {
        const term = normalize(groupSearch.value || "");
        const items = Array.from(document.querySelectorAll("#groupsList .chip"));
        let visible = 0;
        items.forEach((item) => {
          const text = normalize(item.textContent || "");
          const match = term ? text.includes(term) : true;
          item.style.display = match ? "inline-flex" : "none";
          if (match) visible += 1;
        });
        groupCount.textContent = items.length
          ? visible + " grupos visíveis"
          : "";
      }

      async function refreshStatus() {
        const response = await fetch("/status");
        if (!response.ok) return;
        const data = await response.json();
        const statusText = document.getElementById("statusText");
        const qrSection = document.getElementById("qrSection");
        const qrUpdated = document.getElementById("qrUpdated");
        const configSection = document.getElementById("configSection");
        const runtimeSection = document.getElementById("runtimeSection");
        const connectionStatus = document.getElementById("connectionStatus");
        const lastEvent = document.getElementById("lastEvent");
        const lastError = document.getElementById("lastError");
        const currentGroup = document.getElementById("currentGroup");
        const syncStatus = document.getElementById("syncStatus");
        const syncError = document.getElementById("syncError");
        const groupsList = document.getElementById("groupsList");
        const destinationSelect = document.getElementById("destinationSelect");
        const runtimeLog = document.getElementById("runtimeLog");
        const readingDoneNotice = document.getElementById("readingDoneNotice");

        statusText.textContent = data.statusText;
        statusText.parentElement.className = "status " + (data.ready ? "ready" : "");

        qrSection.style.display = data.uiStep === "qr" ? "block" : "none";
        configSection.style.display = data.uiStep === "config" ? "block" : "none";
        runtimeSection.style.display = data.uiStep === "runtime" ? "block" : "none";

        if (data.uiStep === "qr") {
          if (data.qrDataUrl) {
            qrSection.querySelector(".qr")?.remove();
            qrSection.insertAdjacentHTML(
              "afterbegin",
              '<div class="qr"><img src="' + data.qrDataUrl + '" alt="QR Code" /><p>Escaneie o QR Code com o WhatsApp</p></div>'
            );
          } else {
            qrSection.querySelector(".qr")?.remove();
            qrSection.insertAdjacentHTML(
              "afterbegin",
              '<div class="qr placeholder"><div class="qr-box"></div><p>Gerando QR Code...</p></div>'
            );
          }
          qrUpdated.textContent = data.qrUpdatedAt
            ? "Última atualização: " + new Date(data.qrUpdatedAt).toLocaleTimeString()
            : "";
        }
        connectionStatus.textContent = data.connectionStatus || "";
        lastEvent.textContent = data.lastEventText || "";
        lastError.textContent = data.lastErrorText || "";
        currentGroup.textContent = data.currentGroup || "Nenhum";
        syncStatus.textContent = data.syncText || "";
        syncError.textContent = data.syncErrorText || "";
        if (runtimeLog && data.runtimeLines) {
          runtimeLog.innerHTML = data.runtimeLines;
          runtimeLog.scrollTop = runtimeLog.scrollHeight;
        }
        if (readingDoneNotice) {
          readingDoneNotice.style.display = data.readingCompleted ? "block" : "none";
        }

        if (data.availableGroups.length) {
          const selected = new Set(getSelectedGroups());
          const selectedDestination = getSelectedDestination();
          groupsList.innerHTML = data.availableGroups.map((group) => {
            const normalized = group.toLowerCase();
            const checked =
              data.monitoredGroups.includes(normalized) || selected.has(normalized)
                ? "checked"
                : "";
            return '<label class="chip"><input type="checkbox" name="monitoredGroups" value="' + group + '" ' + checked + ' />' + group + '</label>';
          }).join("");

          destinationSelect.innerHTML = data.availableGroups.map((group) => {
            const normalized = group.toLowerCase();
            const selected =
              normalized === selectedDestination ||
              normalized === data.destinationGroup.toLowerCase()
                ? "selected"
                : "";
            return '<option value="' + group + '" ' + selected + '>' + group + '</option>';
          }).join("");
        } else if (data.ready) {
          groupsList.innerHTML = "Nenhum grupo sincronizado ainda.";
        }
        filterGroups();
      }

      setInterval(refreshStatus, 3000);
      filterGroups();
    </script>
  </body>
</html>`;
};

const startConfigServer = () => {
  const port = Number(process.env.UI_PORT || 3000);
  const host = process.env.UI_HOST || "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/") {
      const html = renderForm();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && url.pathname === "/save") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        const data = new URLSearchParams(body);
        const selectedGroups = data.getAll("monitoredGroups");
        const manualGroups = data.get("monitoredGroupsText") || "";
        const monitoredGroupValue =
          selectedGroups.length > 0
            ? selectedGroups.join(",")
            : manualGroups;
        const envValues = {
          MONITORED_GROUPS: monitoredGroupValue,
          DESTINATION_GROUP:
            data.get("destinationGroup") ||
            selectedGroups[0] ||
            manualGroups.split(",")[0] ||
            "",
          LOCATION_KEYWORDS: data.get("locationKeywords") || "",
          AREA_KEYWORDS: data.get("areaKeywords") || "",
          DELAY_MIN_SEC: data.get("delayMinSec") || "",
          DELAY_MAX_SEC: data.get("delayMaxSec") || "",
          LOG_ENABLED: config.logging.enabled ? "true" : "false",
          LOG_DIR: config.logging.directory,
          LOG_FILE: config.logging.fileName,
        };

        applyEnvValues(envValues);
        await writeEnvFile(envValues);
        config = getConfig();
        await refreshMonitoring();

        res.writeHead(302, { Location: "/" });
        res.end();
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/start") {
      state.readingEnabled = true;
      state.readingCompleted = false;
      setUiStep("runtime");
      runLifecycle(async () => {
        await refreshMonitoring();
        await processUnreadMessages();
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/status") {
      const statusText = getStatusText();
      const lastEventText = state.lastEvent
        ? `${state.lastEvent} · ${new Date(state.lastEventAt).toLocaleTimeString()}`
        : "Sem eventos";
      const lastErrorText = state.lastError || "Nenhum erro";
      const syncText = state.isSyncing
        ? "Sincronizando..."
        : state.lastSyncAt
          ? `Última sincronização: ${new Date(
              state.lastSyncAt
            ).toLocaleTimeString()}`
          : "Sem sincronização";
      const syncErrorText = state.lastSyncError || "Nenhum erro";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ready: isClientReady,
          qrDataUrl: state.qrDataUrl,
          qrUpdatedAt: state.qrUpdatedAt,
          availableGroups: state.availableGroups,
          monitoredGroups: [...state.monitoredGroups],
          destinationGroup: config.destinationGroup,
          statusText,
          connectionStatus: state.connectionStatus,
          lastEventText,
          lastErrorText,
          currentGroup: state.currentGroup || "",
          syncText,
          syncErrorText,
          uiStep: state.uiStep,
          runtimeLines: state.runtimeEvents
            .map((entry) => `<div class="log-line">${escapeHtml(entry.time)} · ${escapeHtml(entry.message)}</div>`)
            .join("") || "<div class=\"muted\">Sem eventos ainda.</div>",
          readingCompleted: state.readingCompleted,
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/sync-groups") {
      runLifecycle(async () => {
        await refreshMonitoring();
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/restart") {
      state.readingEnabled = false;
      isClientReady = false;
      state.qrDataUrl = null;
      state.qrUpdatedAt = null;
      runLifecycle(async () => {
        updateConnection("Reiniciando conexão", "restart");
        await safeDestroy("restart");
        await safeInitialize("restart");
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/clear-session") {
      state.readingEnabled = false;
      isClientReady = false;
      state.qrDataUrl = null;
      state.qrUpdatedAt = null;
      runLifecycle(async () => {
        updateConnection("Limpando sessão", "clear_session");
        const authPath = path.join(__dirname, ".wwebjs_auth");
        await safeDestroy("clear_session_destroy");
        try {
          await removeAuthDir(authPath);
          clearConnectionError();
        } catch (error) {
          updateConnection("Erro ao limpar sessão", "clear_session_error", error);
        }
        await safeInitialize("clear_session");
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Rota não encontrada.");
  });

  server.listen(port, host, () => {
    console.log(`Interface disponível em http://${host}:${port}`);
  });
};

client.on("qr", (qr) => {
  setUiStep("qr");
  updateConnection("QR Code disponível", "qr");
  qrcode
    .toDataURL(qr, { width: 220 })
    .then((url) => {
      state.qrDataUrl = url;
      state.qrUpdatedAt = Date.now();
    })
    .catch(() => {
      state.qrDataUrl = null;
      state.qrUpdatedAt = null;
    });
});

client.on("authenticated", () => {
  updateConnection("QR validado", "authenticated");
});

client.on("auth_failure", (message) => {
  updateConnection("Falha de autenticação", "auth_failure", message);
});

client.on("change_state", (stateValue) => {
  updateConnection(`Estado: ${stateValue}`, "change_state");
});

client.on("loading_screen", (percent, message) => {
  updateConnection(`Carregando ${percent}%`, "loading_screen", message);
});

client.on("disconnected", (reason) => {
  updateConnection("Desconectado", "disconnected", reason);
  isClientReady = false;
  state.qrDataUrl = null;
  state.qrUpdatedAt = null;
});

client.on("ready", async () => {
  isClientReady = true;
  state.qrDataUrl = null;
  state.qrUpdatedAt = null;
  setUiStep("config");
  updateConnection("Conectado", "ready");
  console.log("WhatsApp Web conectado. Iniciando leitura.");
  await refreshMonitoring();
});

client.on("message", async (message) => {
  const chat = await message.getChat();
  if (!chat.isGroup) return;

  const normalized = normalizeName(chat.name);
  if (!state.monitoredGroups.has(normalized)) return;

  await handleMessage(message, chat, state.destinationChat);
});

startConfigServer();
process.on("unhandledRejection", (error) => {
  updateConnection("Erro interno", "unhandled_rejection", error);
});

runLifecycle(async () => {
  await safeInitialize("boot");
});
