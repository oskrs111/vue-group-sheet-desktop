const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveDatabase: (data) => ipcRenderer.send('save-database', data),
    saveCollections: (collections) => ipcRenderer.send('save-collections', collections)
});
