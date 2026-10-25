const STORAGE_KEY = "lol-inhouse-drawer.players";
const ARCHIVE_STORAGE_KEY = "lol-inhouse-drawer.rosters.v1";
const MAX_ARCHIVES = 30;

const form = document.querySelector("#rosterForm");
const inputs = [...document.querySelectorAll('input[name="player"]')];
const fields = inputs.map((input) => input.closest(".player-field"));
const rosterCount = document.querySelector("#rosterCount");
const clearButton = document.querySelector("#clearButton");
const drawButton = document.querySelector("#drawButton");
const formMessage = document.querySelector("#formMessage");
const emptyState = document.querySelector("#emptyState");
const teamsGrid = document.querySelector("#teamsGrid");
const blueRoster = document.querySelector("#blueRoster");
const redRoster = document.querySelector("#redRoster");
const swapButton = document.querySelector("#swapButton");
const exportImageButton = document.querySelector("#exportImageButton");
const copyButton = document.querySelector("#copyButton");
const resultFooter = document.querySelector("#resultFooter");
const resultMeta = document.querySelector("#resultMeta");
const resultCode = document.querySelector("#resultCode");
const toast = document.querySelector("#toast");
const rosterShelf = document.querySelector(".roster-shelf");
const saveRosterButton = document.querySelector("#saveRosterButton");
const savedRosterCount = document.querySelector("#savedRosterCount");
const archiveEmpty = document.querySelector("#archiveEmpty");
const archiveList = document.querySelector("#archiveList");
const cloudRosterSection = document.querySelector("#cloudRosterSection");
const cloudRosterName = document.querySelector("#cloudRosterName");
const cloudRosterPlayers = document.querySelector("#cloudRosterPlayers");
const loadCloudRosterButton = document.querySelector("#loadCloudRosterButton");
const saveDialog = document.querySelector("#saveDialog");
const saveDialogForm = document.querySelector("#saveDialogForm");
const archiveNameInput = document.querySelector("#archiveName");
const dialogRosterPreview = document.querySelector("#dialogRosterPreview");
const dialogError = document.querySelector("#dialogError");
const cancelSaveButton = document.querySelector("#cancelSaveButton");
const saveDialogTitle = document.querySelector("#saveDialogTitle");
const saveDialogDescription = document.querySelector("#saveDialogDescription");
const saveDialogButtonLabel = document.querySelector("#saveDialogButtonLabel");
const shareDialog = document.querySelector("#shareDialog");
const shareArchiveName = document.querySelector("#shareArchiveName");
const shareArchivePlayers = document.querySelector("#shareArchivePlayers");
const shareLinkInput = document.querySelector("#shareLinkInput");
const shareQrImage = document.querySelector("#shareQrImage");
const copyShareLinkButton = document.querySelector("#copyShareLinkButton");
const closeShareDialogButton = document.querySelector("#closeShareDialogButton");
const shareImportDialog = document.querySelector("#shareImportDialog");
const sharedArchiveName = document.querySelector("#sharedArchiveName");
const sharedArchivePlayers = document.querySelector("#sharedArchivePlayers");
const shareImportError = document.querySelector("#shareImportError");
const dismissSharedRosterButton = document.querySelector("#dismissSharedRosterButton");
const loadSharedRosterButton = document.querySelector("#loadSharedRosterButton");
const saveSharedRosterButton = document.querySelector("#saveSharedRosterButton");

let lastSplit = "";
let currentResult = null;
let drawing = false;
let toastTimer = null;
let swapMode = false;
let selectedSwapPlayer = null;
let savedRosters = [];
let activeArchiveId = "";
let editingArchiveId = "";
let pendingArchivePlayers = [];
let pendingSharedArchive = null;
let cloudRoster = null;

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function getNames() {
  return inputs.map((input) => normalizeName(input.value));
}

function rosterSignature(names) {
  return names
    .map((name) => normalizeName(name).toLocaleLowerCase("zh-CN"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .join("\u0000");
}

function encodeSharePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeSharePayload(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return JSON.parse(new TextDecoder().decode(bytes));
}

function buildShareLink(archive) {
  const url = new URL(window.location.href);
  url.hash = `share=${encodeSharePayload({
    v: 1,
    n: archive.name,
    p: archive.players,
  })}`;
  return url.href;
}

function renderShareQrCode(link) {
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(link);
    qr.make();
    shareQrImage.src = qr.createDataURL(6, 0);
  } catch {
    shareQrImage.removeAttribute("src");
  }
}

function readSharedArchiveFromHash() {
  const value = new URLSearchParams(window.location.hash.slice(1)).get("share");

  if (!value || value.length > 2048) {
    return null;
  }

  try {
    const payload = decodeSharePayload(value);
    const name = normalizeName(String(payload?.n || "")).slice(0, 24);
    const players = Array.isArray(payload?.p)
      ? payload.p.map((player) => normalizeName(String(player)))
      : [];
    const uniquePlayers = new Set(
      players.map((player) => player.toLocaleLowerCase("zh-CN"))
    );

    if (
      payload?.v !== 1 ||
      !name ||
      players.length !== 6 ||
      players.some((player) => !player || player.length > 16) ||
      uniquePlayers.size !== 6
    ) {
      return null;
    }

    return { name, players };
  } catch {
    return null;
  }
}

function clearShareHash() {
  if (!new URLSearchParams(window.location.hash.slice(1)).has("share")) {
    return;
  }

  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(null, "", url);
}

function randomInteger(maxExclusive) {
  if (maxExclusive <= 0) {
    return 0;
  }

  const range = 0x100000000;
  const limit = range - (range % maxExclusive);
  const buffer = new Uint32Array(1);

  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);

  return buffer[0] % maxExclusive;
}

function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function splitSignature(split) {
  return [split.blue, split.red]
    .map((team) => [...team].sort((a, b) => a.localeCompare(b, "zh-CN")).join("|"))
    .sort()
    .join("::");
}

function drawSplit(names) {
  let split;
  let attempts = 0;

  do {
    const shuffled = shuffle(names);
    split = {
      blue: shuffled.slice(0, 3),
      red: shuffled.slice(3),
    };
    attempts += 1;
  } while (lastSplit && splitSignature(split) === lastSplit && attempts < 12);

  lastSplit = splitSignature(split);
  return split;
}

function updateFormState() {
  const names = getNames();
  const completed = names.filter(Boolean).length;
  rosterCount.textContent = `${completed} / 6`;

  inputs.forEach((input, index) => {
    fields[index].classList.toggle("is-complete", Boolean(names[index]));
    input.removeAttribute("aria-invalid");
    fields[index].classList.remove("is-error");
  });

  formMessage.classList.remove("is-error");

  if (completed === 6) {
    formMessage.textContent = "名单已齐，随时可以开始";
  } else if (completed === 0) {
    formMessage.textContent = "填满 6 个昵称后即可开始";
  } else {
    formMessage.textContent = `还需要填写 ${6 - completed} 位玩家`;
  }

  if (activeArchiveId) {
    const activeArchive = savedRosters.find(
      (archive) => archive.id === activeArchiveId
    );

    if (!activeArchive || rosterSignature(activeArchive.players) !== rosterSignature(names)) {
      activeArchiveId = "";
    }
  }

  saveRosterButton.disabled = drawing || completed !== 6;
  saveRosterButton.querySelector("span").textContent = editingArchiveId
    ? "更新当前存档"
    : "保存当前名单";
  saveNames(names);
  renderArchives();
}

function validateNames() {
  const names = getNames();
  const seen = new Map();
  let duplicateName = "";

  inputs.forEach((input, index) => {
    input.removeAttribute("aria-invalid");
    fields[index].classList.remove("is-error");
  });

  const emptyIndex = names.findIndex((name) => !name);
  if (emptyIndex !== -1) {
    fields[emptyIndex].classList.add("is-error");
    inputs[emptyIndex].setAttribute("aria-invalid", "true");
    formMessage.textContent = `玩家 ${emptyIndex + 1} 的昵称还没有填写`;
    formMessage.classList.add("is-error");
    inputs[emptyIndex].focus();
    return null;
  }

  names.forEach((name, index) => {
    const key = name.toLocaleLowerCase("zh-CN");

    if (seen.has(key)) {
      duplicateName = name;
      const originalIndex = seen.get(key);
      fields[originalIndex].classList.add("is-error");
      fields[index].classList.add("is-error");
      inputs[originalIndex].setAttribute("aria-invalid", "true");
      inputs[index].setAttribute("aria-invalid", "true");
      return;
    }

    seen.set(key, index);
  });

  if (duplicateName) {
    formMessage.textContent = `昵称重复：${duplicateName}`;
    formMessage.classList.add("is-error");
    const duplicateIndex = names.findIndex((name, index) => name === duplicateName && index !== seen.get(name.toLocaleLowerCase("zh-CN")));
    inputs[duplicateIndex].focus();
    return null;
  }

  return names;
}

function createRosterItem(name, index, team) {
  const item = document.createElement("li");
  const number = document.createElement("span");
  const label = document.createElement("span");
  const gem = document.createElement("span");

  number.className = "roster-number";
  number.textContent = String(index + 1).padStart(2, "0");
  label.className = "roster-name";
  label.textContent = name;
  gem.className = "roster-gem";
  gem.setAttribute("aria-hidden", "true");
  item.dataset.team = team;
  item.dataset.player = name;
  item.classList.toggle("is-swappable", swapMode);
  item.addEventListener("click", () => selectSwapPlayer(team, name));

  item.append(number, label, gem);
  return item;
}

function applySwapSelection() {
  document.querySelectorAll(".team-roster li").forEach((item) => {
    const isSelected =
      selectedSwapPlayer &&
      item.dataset.team === selectedSwapPlayer.team &&
      item.dataset.player === selectedSwapPlayer.name;

    item.classList.toggle("is-swappable", swapMode);
    item.classList.toggle("is-selected", Boolean(isSelected));
  });
}

function selectSwapPlayer(team, name) {
  if (!swapMode || !currentResult) {
    return;
  }

  if (
    selectedSwapPlayer &&
    selectedSwapPlayer.team === team &&
    selectedSwapPlayer.name === name
  ) {
    selectedSwapPlayer = null;
    applySwapSelection();
    resultMeta.textContent = "交换模式：选择蓝方一名玩家";
    return;
  }

  if (!selectedSwapPlayer) {
    selectedSwapPlayer = { team, name };
    applySwapSelection();
    resultMeta.textContent = `已选 ${name}，再选择另一队玩家交换`;
    return;
  }

  if (selectedSwapPlayer.team === team) {
    selectedSwapPlayer = { team, name };
    applySwapSelection();
    resultMeta.textContent = `已选 ${name}，再选择另一队玩家交换`;
    return;
  }

  const first = selectedSwapPlayer;
  const firstIndex = currentResult[first.team].indexOf(first.name);
  const secondIndex = currentResult[team].indexOf(name);
  [currentResult[first.team][firstIndex], currentResult[team][secondIndex]] = [
    currentResult[team][secondIndex],
    currentResult[first.team][firstIndex],
  ];
  selectedSwapPlayer = null;
  renderResult(currentResult, currentResult.drawnAt);
  showToast(`已交换 ${first.name} 与 ${name}`);
}

function toggleSwapMode() {
  if (!currentResult) {
    return;
  }

  swapMode = !swapMode;
  selectedSwapPlayer = null;
  swapButton.classList.toggle("is-active", swapMode);
  swapButton.querySelector("span").textContent = swapMode ? "退出交换" : "交换";
  applySwapSelection();

  if (swapMode) {
    resultMeta.textContent = "交换模式：选择蓝方一名玩家";
  } else {
    resultMeta.textContent = `生成于 ${formatDrawTime(currentResult.drawnAt)}`;
  }
}

function formatDrawTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function renderResult(split, drawnAt) {
  currentResult = {
    ...split,
    drawnAt,
    code: `R-${drawnAt.getHours().toString().padStart(2, "0")}${drawnAt
      .getMinutes()
      .toString()
      .padStart(2, "0")}`,
  };

  blueRoster.replaceChildren(
    ...split.blue.map((name, index) => createRosterItem(name, index, "blue"))
  );
  redRoster.replaceChildren(
    ...split.red.map((name, index) => createRosterItem(name, index, "red"))
  );

  emptyState.hidden = true;
  teamsGrid.hidden = false;
  teamsGrid.classList.remove("is-revealing");
  void teamsGrid.offsetWidth;
  teamsGrid.classList.add("is-revealing");

  copyButton.disabled = false;
  swapButton.disabled = false;
  exportImageButton.disabled = false;
  selectedSwapPlayer = null;
  applySwapSelection();
  resultFooter.classList.add("is-ready");
  resultMeta.textContent = swapMode
    ? "交换模式：选择蓝方一名玩家"
    : `生成于 ${formatDrawTime(drawnAt)}`;
  resultCode.textContent = currentResult.code;
  resultCode.hidden = false;
}

function resetResult() {
  if (!currentResult) {
    return;
  }

  currentResult = null;
  emptyState.hidden = false;
  teamsGrid.hidden = true;
  teamsGrid.classList.remove("is-revealing");
  copyButton.disabled = true;
  swapButton.disabled = true;
  exportImageButton.disabled = true;
  swapButton.classList.remove("is-active");
  swapButton.querySelector("span").textContent = "交换";
  swapMode = false;
  selectedSwapPlayer = null;
  resultFooter.classList.remove("is-ready");
  resultMeta.textContent = "名单已更新，重新分队后生成对阵";
  resultCode.hidden = true;
}

function handleDraw() {
  if (drawing) {
    return;
  }

  const names = validateNames();
  if (!names) {
    return;
  }

  drawing = true;
  drawButton.disabled = true;
  clearButton.disabled = true;
  saveRosterButton.disabled = true;
  rosterShelf.classList.add("is-busy");
  inputs.forEach((input) => {
    input.readOnly = true;
  });
  drawButton.classList.add("is-drawing");
  drawButton.querySelector("span").textContent = "正在抽取";

  window.setTimeout(() => {
    const split = drawSplit(names);
    renderResult(split, new Date());
    drawing = false;
    drawButton.disabled = false;
    clearButton.disabled = false;
    saveRosterButton.disabled = getNames().some((name) => !name);
    rosterShelf.classList.remove("is-busy");
    inputs.forEach((input) => {
      input.readOnly = false;
    });
    drawButton.classList.remove("is-drawing");
    drawButton.querySelector("span").textContent = "重新分队";
  }, 420);
}

function saveNames(names) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Storage can be unavailable when local files are opened in a restricted browser.
  }
}

function restoreNames() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    if (Array.isArray(saved)) {
      inputs.forEach((input, index) => {
        input.value = typeof saved[index] === "string" ? saved[index].slice(0, 16) : "";
      });
    }
  } catch {
    // Ignore malformed local data and start with an empty roster.
  }
}

function loadSavedRosters() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARCHIVE_STORAGE_KEY) || "[]");

    if (!Array.isArray(saved)) {
      return [];
    }

    return saved
      .filter(
        (archive) =>
          archive &&
          typeof archive.id === "string" &&
          typeof archive.name === "string" &&
          Array.isArray(archive.players) &&
          archive.players.length === 6 &&
          archive.players.every((name) => typeof name === "string" && name.trim())
      )
      .map((archive) => ({
        id: archive.id,
        name: normalizeName(archive.name).slice(0, 24) || "未命名存档",
        players: archive.players.map((name) => normalizeName(name).slice(0, 16)),
        savedAt: Number.isFinite(archive.savedAt) ? archive.savedAt : Date.now(),
      }))
      .slice(0, MAX_ARCHIVES);
  } catch {
    return [];
  }
}

function persistSavedRosters(rosters = savedRosters) {
  try {
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(rosters));
    return true;
  } catch {
    return false;
  }
}

function createArchiveId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `roster-${Date.now()}-${randomInteger(1000000)}`;
}

function formatArchiveTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function suggestArchiveName() {
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date());

  return `${date} · 内战名单`;
}

function createArchiveItem(archive, isCurrent) {
  const item = document.createElement("li");
  const copy = document.createElement("div");
  const titleRow = document.createElement("div");
  const name = document.createElement("strong");
  const time = document.createElement("time");
  const preview = document.createElement("p");
  const actions = document.createElement("div");
  const loadButton = document.createElement("button");
  const shareButton = document.createElement("button");
  const deleteButton = document.createElement("button");

  item.className = "archive-item";
  item.dataset.archiveId = archive.id;
  item.classList.toggle("is-current", isCurrent);

  copy.className = "archive-copy";
  titleRow.className = "archive-title-row";
  name.className = "archive-item-name";
  name.textContent = archive.name;
  name.title = archive.name;
  time.className = "archive-item-time";
  time.dateTime = new Date(archive.savedAt).toISOString();
  time.textContent = formatArchiveTime(archive.savedAt);
  preview.className = "archive-player-preview";
  preview.textContent = archive.players.join(" · ");

  actions.className = "archive-actions";
  loadButton.type = "button";
  loadButton.className = "archive-load-button";
  loadButton.textContent = isCurrent ? "已调取" : "调取";
  loadButton.setAttribute("aria-label", `调取存档：${archive.name}`);
  loadButton.addEventListener("click", () => loadArchive(archive.id));

  shareButton.type = "button";
  shareButton.className = "archive-share-button";
  shareButton.setAttribute("aria-label", `分享存档：${archive.name}`);
  shareButton.title = "分享存档";
  shareButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
    </svg>
  `;
  shareButton.addEventListener("click", () => openShareDialog(archive.id));

  deleteButton.type = "button";
  deleteButton.className = "archive-delete-button";
  deleteButton.setAttribute("aria-label", `删除存档：${archive.name}`);
  deleteButton.title = "删除存档";
  deleteButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  `;
  deleteButton.addEventListener("click", () => deleteArchive(archive.id));

  titleRow.append(name, time);
  copy.append(titleRow, preview);
  actions.append(loadButton, shareButton, deleteButton);
  item.append(copy, actions);
  return item;
}

function renderArchives() {
  const currentNames = getNames();
  const currentSignature = currentNames.every(Boolean)
    ? rosterSignature(currentNames)
    : "";

  savedRosterCount.textContent = String(savedRosters.length);
  archiveEmpty.hidden = savedRosters.length > 0;
  archiveList.hidden = savedRosters.length === 0;
  archiveList.replaceChildren(
    ...savedRosters.map((archive) => {
      const isCurrent =
        archive.id === activeArchiveId ||
        (Boolean(currentSignature) &&
          rosterSignature(archive.players) === currentSignature);
      return createArchiveItem(archive, isCurrent);
    })
  );
}

function openShareDialog(archiveId) {
  const archive = savedRosters.find((item) => item.id === archiveId);
  if (!archive) {
    return;
  }

  shareArchiveName.textContent = archive.name;
  shareArchivePlayers.textContent = archive.players.join(" · ");
  const link = buildShareLink(archive);
  shareLinkInput.value = link;
  renderShareQrCode(link);
  shareDialog.showModal();

  window.requestAnimationFrame(() => {
    shareLinkInput.focus();
    shareLinkInput.select();
  });
}

function applyRosterToForm(players, archiveName, archiveId = "") {
  inputs.forEach((input, index) => {
    input.value = players[index];
  });
  lastSplit = "";
  updateFormState();
  resetResult();
  activeArchiveId = archiveId;
  editingArchiveId = archiveId;
  renderArchives();
  formMessage.textContent = `已调取存档「${archiveName}」`;
  formMessage.classList.remove("is-error");
}

function isValidCloudRoster(roster) {
  if (!roster || typeof roster.name !== "string" || !Array.isArray(roster.players)) {
    return false;
  }

  const players = roster.players
    .map((player) => normalizeName(String(player)))
    .filter(Boolean);
  const uniquePlayers = new Set(
    players.map((player) => player.toLocaleLowerCase("zh-CN"))
  );

  return players.length === 6 && uniquePlayers.size === 6;
}

async function loadCloudRoster() {
  try {
    const response = await fetch("shared-roster.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const roster = await response.json();
    if (!isValidCloudRoster(roster)) {
      return;
    }

    cloudRoster = {
      name: normalizeName(roster.name).slice(0, 24) || "云端共享名单",
      players: roster.players.map((player) => normalizeName(String(player)).slice(0, 16)),
    };
    cloudRosterSection.hidden = false;
    cloudRosterName.textContent = cloudRoster.name;
    cloudRosterPlayers.textContent = cloudRoster.players.join(" · ");

    if (getNames().every((name) => !name)) {
      applyRosterToForm(cloudRoster.players, cloudRoster.name);
      formMessage.textContent = `已载入云端名单「${cloudRoster.name}」`;
    }
  } catch {
    // A missing or unavailable cloud roster simply keeps the local roster unchanged.
  }
}

function createUniqueSharedName(baseName) {
  const usedNames = new Set(
    savedRosters.map((archive) => archive.name.toLocaleLowerCase("zh-CN"))
  );

  if (!usedNames.has(baseName.toLocaleLowerCase("zh-CN"))) {
    return baseName;
  }

  let suffixNumber = 1;
  let candidate = "";

  do {
    const suffix =
      suffixNumber === 1 ? "（共享）" : `（共享 ${suffixNumber}）`;
    candidate = `${baseName.slice(0, 24 - suffix.length)}${suffix}`;
    suffixNumber += 1;
  } while (usedNames.has(candidate.toLocaleLowerCase("zh-CN")));

  return candidate;
}

function importSharedRoster(shouldSave) {
  if (!pendingSharedArchive) {
    return;
  }

  const shared = pendingSharedArchive;

  if (!shouldSave) {
    applyRosterToForm(shared.players, shared.name);
    dismissSharedRoster();
    showToast("共享名单已调取");
    return;
  }

  const signature = rosterSignature(shared.players);
  const existing = savedRosters.find(
    (archive) => rosterSignature(archive.players) === signature
  );

  if (existing) {
    applyRosterToForm(existing.players, existing.name, existing.id);
    dismissSharedRoster();
    showToast(`这份名单已在存档「${existing.name}」中`);
    return;
  }

  const archive = {
    id: createArchiveId(),
    name: createUniqueSharedName(shared.name),
    players: [...shared.players],
    savedAt: Date.now(),
  };
  const nextRosters = [archive, ...savedRosters].slice(0, MAX_ARCHIVES);

  if (!persistSavedRosters(nextRosters)) {
    shareImportError.textContent = "本机存储不可用，请选择“仅调取”";
    return;
  }

  savedRosters = nextRosters;
  applyRosterToForm(archive.players, archive.name, archive.id);
  dismissSharedRoster();
  showToast("共享名单已保存并调取");
}

function dismissSharedRoster() {
  pendingSharedArchive = null;
  shareImportError.textContent = "";
  if (shareImportDialog.open) {
    shareImportDialog.close();
  }
  clearShareHash();
}

function handleIncomingSharedRoster() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has("share")) {
    return;
  }

  const shared = readSharedArchiveFromHash();
  if (!shared) {
    clearShareHash();
    showToast("共享链接无效或已损坏");
    return;
  }

  pendingSharedArchive = shared;
  sharedArchiveName.textContent = shared.name;
  sharedArchivePlayers.textContent = shared.players.join(" · ");
  shareImportError.textContent = "";
  shareImportDialog.showModal();
}

function openSaveDialog() {
  const names = validateNames();
  if (!names) {
    return;
  }

  const signature = rosterSignature(names);
  const editingArchive = savedRosters.find(
    (archive) => archive.id === editingArchiveId
  );

  if (editingArchive) {
    pendingArchivePlayers = names;
    archiveNameInput.value = editingArchive.name;
    dialogRosterPreview.textContent = names.join(" · ");
    dialogError.textContent = "";
    saveDialogTitle.textContent = "更新名单存档";
    saveDialogDescription.textContent =
      "保存后会覆盖当前存档，并保留它在存档列表中的位置。";
    saveDialogButtonLabel.textContent = "更新存档";
    saveDialog.showModal();

    window.requestAnimationFrame(() => {
      archiveNameInput.focus();
      archiveNameInput.select();
    });
    return;
  }

  const existing = savedRosters.find(
    (archive) => rosterSignature(archive.players) === signature
  );

  if (existing) {
    activeArchiveId = existing.id;
    renderArchives();
    showToast(`这套名单已保存在「${existing.name}」`);
    return;
  }

  pendingArchivePlayers = names;
  archiveNameInput.value = suggestArchiveName();
  dialogRosterPreview.textContent = names.join(" · ");
  dialogError.textContent = "";
  saveDialogTitle.textContent = "保存名单存档";
  saveDialogDescription.textContent = "下次打开页面时可以一键调取这 6 位玩家。";
  saveDialogButtonLabel.textContent = "保存存档";
  saveDialog.showModal();

  window.requestAnimationFrame(() => {
    archiveNameInput.focus();
    archiveNameInput.select();
  });
}

function saveArchive() {
  const name = normalizeName(archiveNameInput.value).slice(0, 24);
  const signature = rosterSignature(pendingArchivePlayers);

  if (!name) {
    dialogError.textContent = "请填写存档名称";
    archiveNameInput.focus();
    return;
  }

  const editingArchive = savedRosters.find(
    (archive) => archive.id === editingArchiveId
  );

  if (editingArchive) {
    const duplicateName = savedRosters.some(
      (archive) =>
        archive.id !== editingArchive.id &&
        archive.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN")
    );

    if (duplicateName) {
      dialogError.textContent = "已经有同名存档，请换一个名称";
      archiveNameInput.focus();
      return;
    }

    const nextRosters = savedRosters.map((archive) =>
      archive.id === editingArchive.id
        ? { ...archive, name, players: [...pendingArchivePlayers], savedAt: Date.now() }
        : archive
    );

    if (!persistSavedRosters(nextRosters)) {
      dialogError.textContent = "本机存储不可用，暂时无法更新";
      return;
    }

    savedRosters = nextRosters;
    activeArchiveId = editingArchive.id;
    editingArchiveId = editingArchive.id;
    renderArchives();
    saveDialog.close();
    showToast("名单存档已更新");
    return;
  }

  if (
    savedRosters.some(
      (archive) =>
        archive.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN")
    )
  ) {
    dialogError.textContent = "已经有同名存档，请换一个名称";
    archiveNameInput.focus();
    return;
  }

  const existing = savedRosters.find(
    (archive) => rosterSignature(archive.players) === signature
  );

  if (existing) {
    dialogError.textContent = `这套名单已保存为「${existing.name}」`;
    return;
  }

  const archive = {
    id: createArchiveId(),
    name,
    players: [...pendingArchivePlayers],
    savedAt: Date.now(),
  };
  const nextRosters = [archive, ...savedRosters].slice(0, MAX_ARCHIVES);

  if (!persistSavedRosters(nextRosters)) {
    dialogError.textContent = "本机存储不可用，暂时无法保存";
    return;
  }

  savedRosters = nextRosters;
  activeArchiveId = archive.id;
  renderArchives();
  saveDialog.close();
  showToast("名单存档已保存");
}

function loadArchive(archiveId) {
  const archive = savedRosters.find((item) => item.id === archiveId);
  if (!archive) {
    return;
  }

  applyRosterToForm(archive.players, archive.name, archive.id);
  showToast(`已调取「${archive.name}」`);
}

function deleteArchive(archiveId) {
  const archive = savedRosters.find((item) => item.id === archiveId);
  if (!archive) {
    return;
  }

  const confirmed = window.confirm(`确定删除存档「${archive.name}」吗？`);
  if (!confirmed) {
    return;
  }

  const previousRosters = savedRosters;
  savedRosters = savedRosters.filter((item) => item.id !== archiveId);

  if (!persistSavedRosters()) {
    savedRosters = previousRosters;
    showToast("本机存储不可用，删除失败");
    return;
  }

  if (activeArchiveId === archiveId) {
    activeArchiveId = "";
  }

  if (editingArchiveId === archiveId) {
    editingArchiveId = "";
  }

  renderArchives();
  showToast("存档已删除");
}

function buildCopyText(result) {
  return [
    "峡谷分队",
    `蓝方：${result.blue.join("、")}`,
    `红方：${result.red.join("、")}`,
    `对阵编号：${result.code}`,
  ].join("\n");
}

async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

async function copyResult() {
  if (!currentResult) {
    return;
  }

  const text = buildCopyText(currentResult);
  const copied = await writeToClipboard(text);

  if (copied) {
    showToast("对阵已复制");
    return;
  }

  showToast("复制失败，请手动选择名单");
}

async function copyShareLink() {
  if (!shareLinkInput.value) {
    return;
  }

  const copied = await writeToClipboard(shareLinkInput.value);
  showToast(copied ? "分享链接已复制" : "复制失败，请手动选择链接");
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createResultImageCanvas(result) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 720;
  const context = canvas.getContext("2d");

  context.fillStyle = "#0b0d11";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(255, 255, 255, 0.035)";
  context.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y < canvas.height; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.textAlign = "center";
  context.fillStyle = "#f1ede3";
  context.font = "700 56px 'Microsoft YaHei', sans-serif";
  context.fillText("峡谷分队", canvas.width / 2, 86);

  context.fillStyle = "#d4b77c";
  context.font = "600 20px 'Bahnschrift', 'Microsoft YaHei', sans-serif";
  context.fillText(`MATCHUP · ${result.code}`, canvas.width / 2, 128);

  const teams = [
    { key: "blue", name: "蓝方", side: "BLUE SIDE", color: "#57b3cf", x: 70 },
    { key: "red", name: "红方", side: "RED SIDE", color: "#d36b65", x: 560 },
  ];

  teams.forEach((team) => {
    roundedRect(context, team.x, 170, 450, 490, 12);
    context.fillStyle = "rgba(255, 255, 255, 0.02)";
    context.fill();
    context.strokeStyle = team.color;
    context.globalAlpha = 0.55;
    context.lineWidth = 2;
    context.stroke();
    context.globalAlpha = 1;

    context.fillStyle = team.color;
    context.font = "600 18px 'Bahnschrift', 'Microsoft YaHei', sans-serif";
    context.textAlign = "left";
    context.fillText(team.side, team.x + 28, 216);

    context.fillStyle = "#f1ede3";
    context.font = "700 40px 'Microsoft YaHei', sans-serif";
    context.fillText(team.name, team.x + 28, 266);

    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.beginPath();
    context.moveTo(team.x + 28, 292);
    context.lineTo(team.x + 422, 292);
    context.stroke();

    result[team.key].forEach((player, index) => {
      const y = 360 + index * 90;
      context.fillStyle = team.color;
      context.font = "600 18px 'Bahnschrift', 'Microsoft YaHei', sans-serif";
      context.fillText(String(index + 1).padStart(2, "0"), team.x + 28, y);

      context.fillStyle = "#f1ede3";
      context.font = "600 34px 'Microsoft YaHei', sans-serif";
      let label = player;
      while (context.measureText(label).width > 340 && label.length > 1) {
        label = `${label.slice(0, -2)}…`;
      }
      context.fillText(label, team.x + 70, y);
    });
  });

  context.textAlign = "center";
  context.fillStyle = "#69707a";
  context.font = "500 18px 'Bahnschrift', 'Microsoft YaHei', sans-serif";
  context.fillText(
    `GENERATED ${formatDrawTime(result.drawnAt)} · 6 PLAYERS`,
    canvas.width / 2,
    696
  );

  return canvas;
}

function exportResultImage() {
  if (!currentResult) {
    return;
  }

  const canvas = createResultImageCanvas(currentResult);
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("导出失败，请重试");
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `峡谷分队-${currentResult.code}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("分队图片已导出");
  }, "image/png");
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.querySelector("span").textContent = message;
  toast.classList.add("is-visible");

  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

inputs.forEach((input) => {
  input.addEventListener("input", () => {
    updateFormState();
    resetResult();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      handleDraw();
    }
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleDraw();
});

clearButton.addEventListener("click", () => {
  inputs.forEach((input) => {
    input.value = "";
  });
  editingArchiveId = "";
  updateFormState();
  resetResult();
  formMessage.textContent = "填满 6 个昵称后即可开始";
  inputs[0].focus();
});

saveRosterButton.addEventListener("click", openSaveDialog);

saveDialogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveArchive();
});

cancelSaveButton.addEventListener("click", () => {
  saveDialog.close();
});

archiveNameInput.addEventListener("input", () => {
  dialogError.textContent = "";
});

saveDialog.addEventListener("click", (event) => {
  if (event.target === saveDialog) {
    saveDialog.close();
  }
});

saveDialog.addEventListener("close", () => {
  pendingArchivePlayers = [];
  dialogError.textContent = "";
});

copyShareLinkButton.addEventListener("click", copyShareLink);

closeShareDialogButton.addEventListener("click", () => {
  shareDialog.close();
});

shareDialog.addEventListener("click", (event) => {
  if (event.target === shareDialog) {
    shareDialog.close();
  }
});

shareDialog.addEventListener("close", () => {
  shareLinkInput.value = "";
});

dismissSharedRosterButton.addEventListener("click", dismissSharedRoster);
loadSharedRosterButton.addEventListener("click", () => importSharedRoster(false));
saveSharedRosterButton.addEventListener("click", () => importSharedRoster(true));

shareImportDialog.addEventListener("click", (event) => {
  if (event.target === shareImportDialog) {
    dismissSharedRoster();
  }
});

shareImportDialog.addEventListener("close", () => {
  if (pendingSharedArchive) {
    pendingSharedArchive = null;
    clearShareHash();
  }
});

window.addEventListener("hashchange", handleIncomingSharedRoster);

swapButton.addEventListener("click", toggleSwapMode);
exportImageButton.addEventListener("click", exportResultImage);
copyButton.addEventListener("click", copyResult);
loadCloudRosterButton.addEventListener("click", () => {
  if (!cloudRoster) {
    return;
  }

  applyRosterToForm(cloudRoster.players, cloudRoster.name);
  formMessage.textContent = `已载入云端名单「${cloudRoster.name}」`;
  showToast("云端名单已载入");
});

savedRosters = loadSavedRosters();
restoreNames();
updateFormState();
handleIncomingSharedRoster();
loadCloudRoster();
