const { contextBridge, ipcRenderer } = require('electron');

function call(channel, ...args) {
    const result = ipcRenderer.sendSync(channel, ...args);
    if (!result?.ok) throw new Error(result?.error || 'No se pudo guardar o cargar el archivo.');
    return result.value;
}

function subscribe(channel, callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
    storage: {
        getItem: key => call('storage:get', key),
        setItem: (key, value) => call('storage:set', key, value)
    },
    importDatabase: (json, merge) => call('storage:import', json, merge),
    refreshWorkspace: () => call('storage:refresh'),
    getSettings: () => call('desktop:settings'),
    saveSettings: backupMinutes => call('desktop:save-settings', backupMinutes),
    chooseWorkspace: () => ipcRenderer.invoke('desktop:choose-workspace'),
    createBackup: () => call('desktop:backup'),
    exportFile: (name, bytes) => ipcRenderer.invoke('desktop:export', name, bytes),
    onOpenSettings: callback => subscribe('open-settings', callback),
    onStorageError: callback => subscribe('storage-error', callback)
});
