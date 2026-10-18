const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Workspace } = require('./workspace');
const { Settings } = require('./settings');

let mainWindow;
let workspace;
let settings;
let backupTimer;
const devURL = !app.isPackaged && process.env.GSE_DEV_URL;
if (devURL) {
    const url = new URL(devURL);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/') {
        throw new Error('La URL de desarrollo debe ser un servidor HTTP local.');
    }
}
const editorURL = devURL || pathToFileURL(path.join(__dirname, 'dist/index.html')).href;

function reportError(error) {
    if (mainWindow) mainWindow.webContents.send('storage-error', error.message);
    else dialog.showErrorBox('Group Sheet Editor', error.message);
}

function configureBackups() {
    clearInterval(backupTimer);
    if (settings.value.backupMinutes > 0) {
        backupTimer = setInterval(() => {
            try { workspace.backup(); } catch (error) { reportError(error); }
        }, settings.value.backupMinutes * 60_000);
        backupTimer.unref();
    }
}

function openWorkspace(directory) {
    if (!fs.statSync(directory).isDirectory()) throw new Error('La carpeta de trabajo no existe.');
    return new Workspace(directory);
}

async function selectWorkspace() {
    const options = {
        title: 'Selecciona la carpeta de trabajo de Group Sheet Editor',
        buttonLabel: 'Usar esta carpeta',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: settings.value.workspace || app.getPath('documents')
    };
    const selection = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths[0]) return false;
    const next = openWorkspace(selection.filePaths[0]);
    settings.save({ workspace: next.directory });
    workspace = next;
    configureBackups();
    if (mainWindow) mainWindow.reload();
    return true;
}

function requireMainFrame(event) {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url.split(/[?#]/)[0] !== editorURL) {
        throw new Error('Solicitud de almacenamiento no permitida.');
    }
}

function registerSync(channel, operation) {
    ipcMain.on(channel, (event, ...args) => {
        try {
            requireMainFrame(event);
            event.returnValue = { ok: true, value: operation(...args) };
        } catch (error) {
            event.returnValue = { ok: false, error: error.message };
            reportError(error);
        }
    });
}

function registerStorage() {
    registerSync('storage:refresh', () => workspace.reload());
    registerSync('storage:get', key => workspace.getItem(key));
    registerSync('storage:set', (key, value) => workspace.setItem(key, value));
    registerSync('storage:import', (json, merge) => {
        if (typeof merge !== 'boolean') throw new Error('Modo de importación inválido.');
        workspace.importDatabase(JSON.parse(json), merge);
    });
    registerSync('desktop:settings', () => ({ ...settings.value }));
    registerSync('desktop:save-settings', backupMinutes => {
        const value = settings.save({ backupMinutes });
        configureBackups();
        return value;
    });
    registerSync('desktop:backup', () => workspace.backup());
    ipcMain.handle('desktop:choose-workspace', async event => {
        requireMainFrame(event);
        try { return await selectWorkspace(); } catch (error) { reportError(error); throw error; }
    });
    ipcMain.handle('desktop:export', (event, name, bytes) => {
        requireMainFrame(event);
        if (!(bytes instanceof Uint8Array)) throw new Error('Contenido de exportación inválido.');
        return workspace.exportFile(name, bytes);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    if (devURL) mainWindow.loadURL(devURL);
    else mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
}

function createMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
        { label: 'Archivo', submenu: [{ role: 'quit', label: 'Salir' }] },
        { label: 'Edición', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { label: 'Opciones', submenu: [
            { label: 'Configuración…', click: () => mainWindow?.webContents.send('open-settings') },
            { label: 'Carpeta de trabajo…', click: async () => {
                try { await selectWorkspace(); } catch (error) { reportError(error); }
            } },
            { label: 'Crear copia de seguridad ahora', click: () => {
                try {
                    const file = workspace.backup();
                    dialog.showMessageBox(mainWindow, { type: 'info', message: 'Copia de seguridad creada.', detail: file });
                } catch (error) { reportError(error); }
            } }
        ] }
    ]));
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow?.isMinimized()) mainWindow.restore();
        mainWindow?.focus();
    });
    app.whenReady().then(async () => {
        settings = new Settings(app.getPath('userData'));
        if (settings.loadError) reportError(new Error('No se pudo leer la configuración. Selecciona de nuevo tu carpeta de trabajo.'));
        if (settings.value.workspace) {
            try { workspace = openWorkspace(settings.value.workspace); } catch (error) { reportError(error); }
        }
        while (!workspace) {
            try {
                if (!await selectWorkspace()) { app.quit(); return; }
            } catch (error) { reportError(error); }
        }
        configureBackups();
        registerStorage();
        createWindow();
        createMenu();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    }).catch(error => { reportError(error); app.quit(); });
}

app.on('before-quit', () => clearInterval(backupTimer));
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
