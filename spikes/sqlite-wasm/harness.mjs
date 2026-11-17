// Điều khiển harness đo SQLite WASM (Task131). Không phải code sản phẩm.
// Mọi số đo hiển thị trên trang và gom vào window.__harness để script đo đọc lại.

const params = new URLSearchParams(location.search);
const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const vfsEl = document.getElementById("vfs");
const rowsEl = document.getElementById("rows");

let nextId = 1;
const pending = new Map();
const worker = new Worker(new URL("./harness-worker.mjs", import.meta.url), { type: "module" });

worker.onmessage = (event) => {
  const { id, ok, result, error } = event.data ?? {};
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  if (ok) entry.resolve(result);
  else entry.reject(new Error(error));
};

function call(op, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, payload });
  });
}

function log(line) {
  const time = new Date().toISOString().slice(11, 19);
  logEl.textContent += `[${time}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

let libInfo = null;
let rows = 0;

async function init() {
  const started = performance.now();
  libInfo = await call("init", { opfs: params.get("memory") !== "1" });
  const elapsed = performance.now() - started;
  vfsEl.textContent = `${libInfo.vfs}${libInfo.opfsAvailable ? " (OPFS có sẵn)" : " (không có OPFS)"}`;
  log(
    `Nạp SQLite ${libInfo.libVersion} trong ${elapsed.toFixed(0)}ms — VFS ${libInfo.vfs}, ` +
      `crossOriginIsolated=${libInfo.crossOriginIsolated}`,
  );
  return { ...libInfo, loadMs: elapsed };
}

async function reset(extraColumns = 0) {
  const res = await call("reset", { extraColumns });
  rows = 0;
  rowsEl.textContent = "0";
  log(`Tạo lại bảng metrics (${extraColumns + 4} cột giá trị)`);
  return res;
}

async function insert(count, extraColumns = 0) {
  setStatus(`Đang chèn ${count.toLocaleString("vi-VN")} dòng...`);
  const res = await call("insert", { rows: count, extraColumns });
  rows = res.totalRows;
  rowsEl.textContent = rows.toLocaleString("vi-VN");
  setStatus("");
  log(`Chèn ${count.toLocaleString("vi-VN")} dòng: ${res.ms.toFixed(0)}ms (tổng ${rows.toLocaleString("vi-VN")})`);
  return res;
}

async function countRows() {
  const res = await call("count");
  log(`SELECT count(*): ${res.rows.toLocaleString("vi-VN")} dòng trong ${res.ms.toFixed(1)}ms`);
  return res;
}

async function exportDb() {
  const res = await call("export");
  log(`Xuất file DB: ${(res.bytes / 1048576).toFixed(2)} MB`);
  return res;
}

// RAM: API chuẩn của Chrome chỉ đo agent cluster của TRANG (không gồm worker),
// nên đo thêm heap WASM bên trong worker nơi SQLite thực sự giữ dữ liệu.
async function pageMemory() {
  if (typeof performance.measureUserAgentSpecificMemory === "function") {
    try {
      const m = await performance.measureUserAgentSpecificMemory();
      // Chrome chỉ trả bộ nhớ của agent cluster trang; heap WASM của worker là số riêng (đọc trong worker).
      // Không cộng hai số này thành "tổng RAM trang" khi chưa đối chiếu Task Manager.
      return {
        method: "measureUserAgentSpecificMemory",
        scope: "page agent cluster only, không gồm heap WASM của worker",
        totalBytes: m.bytes,
        isolated: self.crossOriginIsolated,
      };
    } catch (err) {
      return { method: "measureUserAgentSpecificMemory", error: String(err), isolated: self.crossOriginIsolated };
    }
  }
  const legacy = performance.memory;
  return {
    method: "performance.memory (fallback, không gồm worker)",
    usedJSHeapSize: legacy?.usedJSHeapSize ?? null,
    isolated: self.crossOriginIsolated,
  };
}

async function memory() {
  const worker = await call("memory");
  const page = await pageMemory();
  return { page, worker };
}

// persist() có thể treo chờ quyết định quyền trong headless: cắt sau 3 giây, ghi rõ là null.
async function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function storageInfo() {
  const estimate = navigator.storage?.estimate ? await withTimeout(navigator.storage.estimate(), 3000) : null;
  const persisted = navigator.storage?.persist ? await withTimeout(navigator.storage.persist(), 3000) : null;
  return { estimate, persisted };
}

// Gộp tài nguyên của trang và của worker: sqlite3.wasm chỉ tải trong worker nên
// performance của trang không bao giờ thấy nó.
async function resources() {
  const pageEntries = performance
    .getEntriesByType("resource")
    .filter((e) => /vendor\/|harness-/.test(e.name))
    .map((e) => ({
      name: e.name.split("/").pop(),
      durationMs: Math.round(e.duration),
      transferSize: e.transferSize,
      encodedBodySize: e.encodedBodySize,
      decodedBodySize: e.decodedBodySize,
    }));
  const workerEntries = await call("resources");
  return [...pageEntries, ...workerEntries];
}

function ready() {
  const ms = performance.now();
  window.__readyMs = ms;
  window.__harnessReady = true;
  document.dispatchEvent(new CustomEvent("harness-ready", { detail: { ms } }));
}

window.__harness = {
  init,
  reset,
  insert,
  count: countRows,
  exportDb,
  memory,
  storageInfo,
  resources,
  // Để measure.mjs ghi số RAM vào nhật ký hiển thị trên trang, nhờ đó ảnh chụp AC2 có đúng số như JSON.
  logLine(line) {
    log(String(line));
  },
  get libInfo() {
    return libInfo;
  },
  get rows() {
    return rows;
  },
};

// Nối nút bấm trên giao diện.
document.getElementById("btn-init").addEventListener("click", () => void init().then(ready));
document.getElementById("btn-reset").addEventListener("click", () => void reset());
document.getElementById("btn-10k").addEventListener("click", () => void insert(10000));
document.getElementById("btn-100k").addEventListener("click", () => void insert(100000));
document.getElementById("btn-500k").addEventListener("click", () => void insert(500000));
document.getElementById("btn-count").addEventListener("click", () => void countRows());
document.getElementById("btn-export").addEventListener("click", () => void exportDb());
document.getElementById("btn-memory").addEventListener("click", async () => {
  const m = await memory();
  log(`RAM: ${JSON.stringify(m)}`);
});

if (params.get("autostart") === "1") {
  void init().then(ready);
}
