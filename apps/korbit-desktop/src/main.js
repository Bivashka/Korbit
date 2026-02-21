const { app, BrowserWindow, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'http://localhost:3000';

function readConfiguredUrl() {
  const envUrl = process.env.KORBIT_APP_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  const argUrl = process.argv
    .find((argument) => argument.startsWith('--url='))
    ?.slice('--url='.length)
    .trim();
  if (argUrl) {
    return argUrl;
  }

  try {
    const filePath = path.join(process.cwd(), 'korbit-desktop-url.txt');
    if (fs.existsSync(filePath)) {
      const fileValue = fs.readFileSync(filePath, 'utf8').trim();
      if (fileValue) {
        return fileValue;
      }
    }
  } catch {
    // ignore local file read issues
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

