# Running Cifia Fintech on Windows PC

## Option 1: Install Directly as a Windows Desktop App (Recommended)
1. Open the hosted Cifia Fintech web app in **Microsoft Edge** or **Google Chrome** on your Windows PC.
2. Click the **Install App** button in the sidebar/header (or the install icon in the browser address bar).
3. Windows will add **Cifia Fintech** to your Desktop and Start Menu as a standalone window app.

## Option 2: Build a Standalone Windows `.exe` Installer Locally
If you need a standalone `.exe` installer for distribution, run these steps on a Windows PC with Node.js 20+ installed:

1. Download/extract this project folder to your Windows machine.
2. Install project dependencies and Electron packaging tools:
   ```powershell
   npm install
   npm install --save-dev electron electron-builder
   ```
3. Build the web bundle and package the Windows `.exe` installer:
   ```powershell
   npm run build
   npx electron-builder --win --config electron-builder.json
   ```
4. Your Windows installer (`Cifia Fintech Setup x.x.x.exe`) will be generated inside the `release/` folder.

> Note: `electron/main.cjs` serves the bundled UI on `http://localhost:4173` so Firebase Authentication (`localhost`) works seamlessly inside the desktop window.
