// Cashmere — main process. Owns the ledger file and exposes a tiny IPC API.
// Nothing leaves this Mac: no network, no bank sync.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const DB_FILE = "ledger.json";
const settingsPath = path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch (e) { return {}; }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
}

let dataDir = process.env.CM_DATA || loadSettings().dataDir || path.join(app.getPath("documents"), "Cashmere2");

function ensureDirs(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
}

// Returns {db} or {error}. A corrupt file is reported, never overwritten.
function readDb(dir) {
  const p = path.join(dir, DB_FILE);
  if (!fs.existsSync(p)) return { db: null };
  try {
    const db = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!db || typeof db !== "object") throw new Error("not an object");
    return { db };
  } catch (e) {
    return { error: "ledger.json could not be read (" + e.message + "). Fix or rename the file in " + dir + " and reopen the app." };
  }
}

// Write atomically, keep the previous version, and keep one dated snapshot per day (last 60).
async function writeDb(db) {
  ensureDirs(dataDir);
  const p = path.join(dataDir, DB_FILE);
  const tmp = p + ".tmp";
  if (fs.existsSync(p)) {
    await fsp.copyFile(p, path.join(dataDir, "ledger.backup.json"));
    const day = new Date().toISOString().slice(0, 10);
    const snap = path.join(dataDir, "backups", "ledger-" + day + ".json");
    if (!fs.existsSync(snap)) {
      await fsp.copyFile(p, snap);
      const snaps = (await fsp.readdir(path.join(dataDir, "backups"))).filter((f) => /^ledger-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const old of snaps.slice(0, Math.max(0, snaps.length - 60))) await fsp.unlink(path.join(dataDir, "backups", old));
    }
  }
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, p);
}

function stateFor(dir) {
  ensureDirs(dir);
  const r = readDb(dir);
  return { dataDir: dir, db: r.db || null, error: r.error || null };
}

ipcMain.handle("state", () => stateFor(dataDir));
ipcMain.handle("db:save", async (_e, db) => { await writeDb(db); return { ok: true }; });

ipcMain.handle("folder:choose", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(win, {
    title: "Choose where Cashmere2 keeps your ledger",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: dataDir,
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const next = res.filePaths[0];
  if (next === dataDir) return stateFor(dataDir);
  ensureDirs(next);
  // Empty destination: carry the current ledger across so nothing is lost.
  if (!fs.existsSync(path.join(next, DB_FILE)) && fs.existsSync(path.join(dataDir, DB_FILE))) {
    await fsp.copyFile(path.join(dataDir, DB_FILE), path.join(next, DB_FILE));
  }
  dataDir = next;
  saveSettings({ ...loadSettings(), dataDir });
  return stateFor(dataDir);
});

ipcMain.handle("folder:reveal", () => { ensureDirs(dataDir); shell.showItemInFolder(path.join(dataDir, DB_FILE)); return { ok: true }; });

ipcMain.handle("export:csv", async (_e, { name, text }) => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showSaveDialog(win, { title: "Export", defaultPath: path.join(app.getPath("downloads"), name), filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (res.canceled || !res.filePath) return { ok: false };
  await fsp.writeFile(res.filePath, text);
  return { ok: true, path: res.filePath };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1240, height: 840, minWidth: 900, minHeight: 620,
    title: "Cashmere2",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: "#f6f1ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "src", "index.html"), { hash: process.env.CM_VIEW || "" });
  // Test hook: CM_SHOT=/path/out.png captures the window after load and quits.
  if (process.env.CM_SHOT) {
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      try { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.CM_SHOT, img.toPNG()); } catch (e) { console.error(e); }
      app.quit();
    }, Number(process.env.CM_SHOT_DELAY || 1500)));
  }
  // Test hook: CM_TEST=/path/script.js runs in the page after load, writes its result to CM_TEST_OUT, then quits.
  if (process.env.CM_TEST) {
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      let out;
      try { out = await win.webContents.executeJavaScript(fs.readFileSync(process.env.CM_TEST, "utf8"), true); } catch (e) { out = { error: String(e && e.stack || e) }; }
      fs.writeFileSync(process.env.CM_TEST_OUT || "/dev/stdout", JSON.stringify(out, null, 2));
      app.quit();
    }, 800));
  }
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
}

const template = [
  { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { role: "quit" }] },
  { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }] },
];

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  ensureDirs(dataDir);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { app.quit(); });
