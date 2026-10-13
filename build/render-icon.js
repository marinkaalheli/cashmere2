// Renders build/icon.svg to a transparent 1024px PNG through Chromium (qlmanage paints transparency white).
const { app, BrowserWindow } = require("electron");
const fs = require("fs"); const path = require("path");
const svg = fs.readFileSync(path.join(__dirname, "icon.svg"), "utf8");
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 1100, webPreferences: { offscreen: true } });
  await win.loadURL("data:text/html,<canvas id=c width=1024 height=1024></canvas>");
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
    const img = new Image(); img.onload = () => { const c = document.getElementById("c"); c.getContext("2d").drawImage(img, 0, 0, 1024, 1024); res(c.toDataURL("image/png")); };
    img.onerror = (e) => rej("svg load failed"); img.src = "data:image/svg+xml;base64," + ${JSON.stringify(Buffer.from(svg).toString("base64"))};
  })`);
  fs.writeFileSync(path.join(__dirname, "icon-1024.png"), Buffer.from(dataUrl.split(",")[1], "base64"));
  app.quit();
});
