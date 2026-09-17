const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  Notification,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const path = require("node:path");
const BASE = `http://127.0.0.1:${process.env.PORT || "4321"}`;
let win,
  tray,
  quitting = false;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  app.whenReady().then(() => {
    app.setAppUserModelId("br.controleinterno.demo");
    win = new BrowserWindow({
      width: 1350,
      height: 900,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const trusted = (event) =>
      event.sender === win.webContents &&
      event.senderFrame?.url.startsWith(BASE + "/");
    ipcMain.handle("copy-text", (event, text) => {
      if (!trusted(event) || typeof text !== "string" || text.length > 100000)
        throw Error("FORBIDDEN");
      clipboard.writeText(text);
    });
    ipcMain.handle("notify", (event, title, body) => {
      if (
        !trusted(event) ||
        typeof title !== "string" ||
        typeof body !== "string" ||
        title.length > 100 ||
        body.length > 500
      )
        throw Error("FORBIDDEN");
      if (Notification.isSupported()) new Notification({ title, body }).show();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== BASE) event.preventDefault();
    });
    win.webContents.session.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    win.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    const icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    );
    tray = new Tray(icon);
    tray.setToolTip("Controle Interno · Demonstração");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir painel", click: () => win.show() },
        {
          label: "Sair",
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("double-click", () => win.show());
    win.loadURL(BASE);
  });
  app.on("before-quit", () => {
    quitting = true;
  });
}
// Servidor é processo separado iniciado com npm start. Autostart/serviço/instalador ainda são backlog.
