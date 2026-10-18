const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            // Security best practices:
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Load the compiled Vue index.html from the submodule
    win.loadFile(path.join(__dirname, 'src/web/dist/index.html'));

    // Optional: win.webContents.openDevTools();
}

app.whenReady().then(() => {
    // IPC Handlers
    ipcMain.on('save-database', (event, data) => {
        try {
            // In a real app we would use user data path
            const filePath = path.join(app.getPath('documents'), 'GroupSheetSongs.json');
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            console.log('Database saved at:', filePath);
        } catch (e) {
            console.error('Failed to save DB:', e);
        }
    });

    ipcMain.on('save-collections', (event, collections) => {
        try {
            const filePath = path.join(app.getPath('documents'), 'GroupSheetCollections.json');
            fs.writeFileSync(filePath, JSON.stringify(collections, null, 2), 'utf-8');
            console.log('Collections saved at:', filePath);
        } catch (e) {
            console.error('Failed to save collections:', e);
        }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
