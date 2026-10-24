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
const saveDialog = document.querySelector("#saveDialog");
const saveDialogForm = document.querySelector("#saveDialogForm");
const archiveNameInput = document.querySelector("#archiveName");
const dialogRosterPreview = document.querySelector("#dialogRosterPreview");
const dialogError = document.querySelector("#dialogError");
const cancelSaveButton = document.querySelector("#cancelSaveButton");

let lastSplit = "";
let currentResult = null;
let drawing = false;
let toastTimer = null;
let savedRosters = [];
let activeArchiveId = "";
let pendingArchivePlayers = [];

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

function createRosterItem(name, index) {
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

  item.append(number, label, gem);
  return item;
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
    ...split.blue.map((name, index) => createRosterItem(name, index))
  );
  redRoster.replaceChildren(
    ...split.red.map((name, index) => createRosterItem(name, index))
  );

  emptyState.hidden = true;
  teamsGrid.hidden = false;
  teamsGrid.classList.remove("is-revealing");
  void teamsGrid.offsetWidth;
  teamsGrid.classList.add("is-revealing");

  copyButton.disabled = false;
  resultFooter.classList.add("is-ready");
  resultMeta.textContent = `生成于 ${formatDrawTime(drawnAt)}`;
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
  actions.append(loadButton, deleteButton);
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

function openSaveDialog() {
  const names = validateNames();
  if (!names) {
    return;
  }

  const signature = rosterSignature(names);
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

  inputs.forEach((input, index) => {
    input.value = archive.players[index];
  });
  lastSplit = "";
  updateFormState();
  resetResult();
  activeArchiveId = archive.id;
  renderArchives();
  formMessage.textContent = `已调取存档「${archive.name}」`;
  formMessage.classList.remove("is-error");
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

async function copyResult() {
  if (!currentResult) {
    return;
  }

  const text = buildCopyText(currentResult);
  let copied = false;

  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    copied = document.execCommand("copy");
    textarea.remove();
  }

  if (copied) {
    showToast("对阵已复制");
    return;
  }

  showToast("复制失败，请手动选择名单");
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

copyButton.addEventListener("click", copyResult);

savedRosters = loadSavedRosters();
restoreNames();
updateFormState();
