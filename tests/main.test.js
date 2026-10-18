const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { Settings } = require('../settings');

async function boot(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gse-main-test-'));
    const workspace = path.join(directory, 'workspace');
    fs.mkdirSync(workspace);
    if (options.configured) new Settings(path.join(directory, 'config')).save({
        workspace: options.missing ? path.join(directory, 'missing') : workspace
    });
    const app = new EventEmitter();
    app.isPackaged = Boolean(options.packaged);
    app.requestSingleInstanceLock = () => true;
    app.whenReady = () => Promise.resolve();
    app.getPath = name => name === 'userData' ? path.join(directory, 'config') : directory;
    app.quit = () => { app.quitted = true; };
    const windows = [];
    const ipc = { sync: new Map(), async: new Map() };
    const events = new EventEmitter();
    const errors = [];
    const timers = new Set();
    let menu;
    let folderRequests = 0;
    class Window extends EventEmitter {
        constructor() {
            super();
            this.webContents = {
                mainFrame: { url: options.devURL && !options.packaged ? options.devURL : pathToFileURL(path.resolve(__dirname, '../dist/index.html')).href },
                send: (channel, value) => events.emit(channel, {}, value),
                setWindowOpenHandler() {}
            };
            windows.push(this);
        }
        loadFile(file) { this.file = file; }
        loadURL(url) { this.url = url; }
        reload() { this.reloaded = true; }
        static getAllWindows() { return windows; }
    }
    const electron = {
        app, BrowserWindow: Window,
        ipcMain: { on: (key, fn) => ipc.sync.set(key, fn), handle: (key, fn) => ipc.async.set(key, fn) },
        dialog: {
            showOpenDialog: async () => { folderRequests++; return { canceled: options.cancel, filePaths: [workspace] }; },
            showErrorBox: (_title, message) => errors.push(message), showMessageBox() {}
        },
        Menu: { buildFromTemplate: template => template, setApplicationMenu: value => { menu = value; } }, shell: {}
    };
    const mainRequire = createRequire(path.join(__dirname, '../main.js'));
    const context = {
        require: name => name === 'electron' ? electron : mainRequire(name),
        __dirname: path.resolve(__dirname, '..'), Uint8Array, URL,
        process: { platform: process.platform, env: { ...process.env, GSE_DEV_URL: options.devURL } },
        setInterval: (callback, milliseconds) => {
            const timer = { callback, milliseconds, unref() {} };
            timers.add(timer);
            return timer;
        },
        clearInterval: timer => timers.delete(timer)
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));
    t.after(() => {
        app.emit('before-quit');
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    function event() {
        const sender = windows[0].webContents;
        return { sender, senderFrame: sender.mainFrame };
    }
    function call(channel, ...args) {
        const request = event();
        ipc.sync.get(channel)(request, ...args);
        return request.returnValue;
    }
    return { directory, workspace, app, windows, ipc, events, errors, timers, call, event, menu, folderRequests };
}

test('first launch asks for a folder, persists it, and schedules five-minute backups', async t => {
    const instance = await boot(t);
    assert.equal(instance.folderRequests, 1);
    assert.equal(instance.windows.length, 1);
    assert.match(instance.windows[0].file, /dist[\\/]index.html$/);
    assert.equal(new Settings(path.join(instance.directory, 'config')).value.workspace, instance.workspace);
    assert.equal([...instance.timers][0].milliseconds, 5 * 60_000);
    [...instance.timers][0].callback();
    assert.equal(fs.readdirSync(path.join(instance.workspace, 'Backup')).length, 1);
    assert.ok(instance.menu.some(item => item.label === 'Opciones'));
});

test('development loads Vite and permits storage only for its exact local URL', async t => {
    const devURL = 'http://127.0.0.1:5173/';
    const instance = await boot(t, { devURL });
    assert.equal(instance.windows[0].url, devURL);
    assert.equal(instance.call('desktop:settings').ok, true);
    const request = instance.event();
    request.senderFrame.url = 'http://127.0.0.1:5174/';
    instance.ipc.sync.get('desktop:settings')(request);
    assert.equal(request.returnValue.ok, false);
});

test('installed applications ignore development URLs and load the bundled editor', async t => {
    const instance = await boot(t, { devURL: 'http://127.0.0.1:5173/', packaged: true });
    assert.equal(instance.windows[0].url, undefined);
    assert.match(instance.windows[0].file, /dist[\\/]index.html$/);
    assert.equal(instance.call('desktop:settings').ok, true);
});

test('configured launches reuse the workspace; cancelling first launch quits before editing', async t => {
    const configured = await boot(t, { configured: true });
    assert.equal(configured.folderRequests, 0);
    assert.equal(configured.windows.length, 1);
    const cancelled = await boot(t, { cancel: true });
    assert.equal(cancelled.app.quitted, true);
    assert.equal(cancelled.windows.length, 0);
    assert.equal(cancelled.timers.size, 0);
});

test('an unavailable configured workspace requests another folder without recreating the missing location', async t => {
    const instance = await boot(t, { configured: true, missing: true });
    assert.equal(instance.folderRequests, 1);
    assert.equal(instance.windows.length, 1);
    assert.equal(fs.existsSync(path.join(instance.directory, 'missing')), false);
    assert.equal(instance.errors.length, 1);
    assert.equal(new Settings(path.join(instance.directory, 'config')).value.workspace, instance.workspace);
});

test('options reschedule or disable automatic backups and expose errors to the renderer', async t => {
    const instance = await boot(t);
    assert.equal(instance.call('desktop:save-settings', 2).ok, true);
    assert.equal(instance.timers.size, 1);
    assert.equal([...instance.timers][0].milliseconds, 120_000);
    assert.equal(instance.call('desktop:save-settings', 0).ok, true);
    assert.equal(instance.timers.size, 0);
    assert.equal(instance.call('desktop:save-settings', -1).ok, false);
    assert.equal(instance.call('desktop:settings').value.backupMinutes, 0);
    let errorMessage;
    instance.events.on('storage-error', (_event, message) => { errorMessage = message; });
    instance.call('desktop:save-settings', 5);
    fs.renameSync(path.join(instance.workspace, 'Backup'), path.join(instance.workspace, 'Backup-moved'));
    [...instance.timers][0].callback();
    assert.ok(errorMessage);
});

test('preload round-trips through IPC and rejects requests outside the main frame', async t => {
    const instance = await boot(t);
    let api;
    const ipcRenderer = {
        sendSync: (channel, ...args) => instance.call(channel, ...args),
        invoke: (channel, ...args) => instance.ipc.async.get(channel)(instance.event(), ...args),
        on: (channel, fn) => instance.events.on(channel, fn),
        removeListener: (channel, fn) => instance.events.removeListener(channel, fn)
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), {
        require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } })
    });
    api.storage.setItem('groupSheetCollections', JSON.stringify([{ id: 'set', name: 'Set', songs: ['portable-id'] }]));
    assert.equal(JSON.parse(api.storage.getItem('groupSheetCollections'))[0].songs[0], 'portable-id');
    fs.writeFileSync(path.join(instance.workspace, 'Collections/manual.col'), JSON.stringify({ id: 'manual', name: 'Copiada', songs: ['pending'] }));
    api.refreshWorkspace();
    assert.equal(JSON.parse(api.storage.getItem('groupSheetCollections')).length, 2);
    assert.throws(() => api.storage.setItem('other', '[]'), /permitido/);
    let opened = 0;
    const stop = api.onOpenSettings(() => { opened++; });
    instance.events.emit('open-settings', {});
    stop();
    instance.events.emit('open-settings', {});
    assert.equal(opened, 1);
    const unauthorized = { sender: {}, senderFrame: {} };
    instance.ipc.sync.get('storage:refresh')(unauthorized);
    assert.equal(unauthorized.returnValue.ok, false);
    instance.ipc.sync.get('desktop:settings')(unauthorized);
    assert.equal(unauthorized.returnValue.ok, false);
    const remote = instance.event();
    const localURL = remote.senderFrame.url;
    remote.senderFrame.url = 'https://example.com';
    instance.ipc.sync.get('desktop:settings')(remote);
    assert.equal(remote.returnValue.ok, false);
    remote.senderFrame.url = localURL;
    const file = await api.exportFile('native.pdf', new Uint8Array([1, 2, 3]));
    assert.deepEqual(fs.readFileSync(file), Buffer.from([1, 2, 3]));
});
