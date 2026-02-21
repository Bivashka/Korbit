const { app, BrowserWindow, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'http://localhost:3000';
const BUNDLED_URL_FILE = 'runtime-url.txt';

function normalizeUrl(raw) {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  return value;
}

function readTextFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function readBundledUrl() {
  const localBundled = normalizeUrl(
    readTextFileIfExists(path.join(__dirname, BUNDLED_URL_FILE)),
  );
  if (localBundled) {
    return localBundled;
  }

  const appPathBundled = normalizeUrl(
    readTextFileIfExists(path.join(app.getAppPath(), 'src', BUNDLED_URL_FILE)),
  );
  if (appPathBundled) {
    return appPathBundled;
  }

  return null;
}

function readConfiguredUrl() {
  const envUrl = normalizeUrl(process.env.KORBIT_APP_URL);
  if (envUrl) {
    return envUrl;
  }

  const argUrl = normalizeUrl(
    process.argv
    .find((argument) => argument.startsWith('--url='))
    ?.slice('--url='.length)
    .trim(),
  );
  if (argUrl) {
    return argUrl;
  }

  const fileCandidates = [
    path.join(path.dirname(process.execPath), 'korbit-desktop-url.txt'),
    path.join(process.cwd(), 'korbit-desktop-url.txt'),
  ];
  for (const candidate of fileCandidates) {
    const fileUrl = normalizeUrl(readTextFileIfExists(candidate));
    if (fileUrl) {
      return fileUrl;
    }
  }

  const bundledUrl = readBundledUrl();
  if (bundledUrl) {
    return bundledUrl;
  }

  return DEFAULT_URL;
}

function createMainWindow() {
  const targetUrl = readConfiguredUrl();
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    backgroundColor: '#d6e0ea',
    title: 'Korbit Desktop',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(targetUrl)) {
      return;
    }
    event.preventDefault();
    void shell.openExternal(url);
  });

  void mainWindow.loadURL(targetUrl);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
