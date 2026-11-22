const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

let server = null;

function startStaticServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const safeRelPath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      let filePath = path.join(DIST_DIR, safeRelPath === '/' ? 'index.html' : safeRelPath);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      resolve(`http://localhost:${PORT}`);
    });
  });
}

async function createWindow() {
  const startUrl = await startStaticServer();

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'Cifia Fintech',
    icon: path.join(__dirname, '..', 'public', 'pwa-512x512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Allow Firebase Google Sign-In popup windows, open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('https://accounts.google.com') ||
      url.includes('firebaseapp.com/__/auth') ||
      url.startsWith('http://localhost:')
    ) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL(startUrl);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
