'use strict';

const { app, BrowserWindow, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Dev mode: the React dev server is running and we load it over HTTP.
// Prod mode: the packaged renderer is served from disk via the app:// scheme.
const isDev = !app.isPackaged && process.env.ELECTRON_DEV === '1';
const DEV_URL = process.env.RENDERER_URL || 'http://localhost:3000';

const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://bundle`;
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

// Custom scheme must be registered before the app is ready. Marking it
// "standard" gives it a real origin (app://bundle) and "secure" lets it use
// localStorage, fetch, etc. like an https page.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

/**
 * Serve the built renderer from disk. Any request for a path that isn't a real
 * file (i.e. a client-side route like /calendar or /login) falls back to
 * index.html so React Router can handle it.
 */
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname);
    let filePath = path.join(RENDERER_DIR, relative);

    const isAsset = Boolean(path.extname(relative));
    if (!isAsset || !fs.existsSync(filePath)) {
      filePath = path.join(RENDERER_DIR, 'index.html');
    }

    // Guard against path traversal outside the renderer directory.
    if (!path.resolve(filePath).startsWith(path.resolve(RENDERER_DIR))) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = await fs.promises.readFile(filePath);
      const type = MIME[path.extname(filePath)] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f8fafc',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links (http/https) in the user's browser, not in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Wire up auto-updates. Only runs in a packaged build; in dev there's nothing
 * to update. Requires a configured `publish` provider (see package.json) and a
 * release feed to actually find updates.
 */
function setupAutoUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater not available:', err);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.on('checking-for-update', () => console.log('[updater] checking…'));
  autoUpdater.on('update-available', (info) =>
    console.log('[updater] update available:', info.version),
  );
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
  autoUpdater.on('download-progress', (p) =>
    console.log(`[updater] downloading ${Math.round(p.percent)}%`),
  );
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded:', info.version, '— will install on quit');
    // Install on next quit; could prompt the user here instead.
    // autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => console.error('[updater] error:', err));

  autoUpdater.checkForUpdatesAndNotify().catch((err) =>
    console.error('[updater] check failed:', err),
  );
}

// Single-instance lock: focus the existing window instead of opening another.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (!isDev) registerAppProtocol();
    createWindow();
    setupAutoUpdates();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
