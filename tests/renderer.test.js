const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Workspace } = require('../workspace');

test('the same stores save, reload, import, export and undo in browser and desktop', async t => {
    const { createServer } = await import('vite');
    const { createPinia, setActivePinia } = await import('pinia');
    const { computed } = await import('vue');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gse-renderer-test-'));
    const server = await createServer({
        root: path.resolve(__dirname, '../..'), configFile: false,
        server: { middlewareMode: true }, appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] }
    });
    t.after(async () => {
        await server.close();
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        fs.rmSync(directory, { recursive: true, force: true });
        delete globalThis.window;
        delete globalThis.localStorage;
    });
    const { useSheetStore } = await server.ssrLoadModule('/src/stores/sheetStore.js');
    const { useCollectionStore } = await server.ssrLoadModule('/src/stores/collectionStore.js');
    const { saveExport } = await server.ssrLoadModule('/src/utils/saveExport.js');
    const { getSheetFontStyles } = await server.ssrLoadModule('/src/utils/sheetFonts.js');
    const memory = new Map();
    globalThis.localStorage = {
        getItem: key => memory.get(key) ?? null,
        setItem: (key, value) => memory.set(key, value)
    };

    const { useConfirmDialog } = await server.ssrLoadModule('/src/composables/useConfirmDialog.js');
    const { chooseBackupImport, lyricsExportOptions } = await server.ssrLoadModule('/src/utils/dialogChoices.js');
    await t.test('backup merge, replacement and cancellation remain distinct at both confirmation steps', async () => {
        for (const [actions, expected] of [
            [['onCancel'], null], [['onConfirm'], true],
            [['onAlternative', 'onCancel'], null], [['onAlternative', 'onConfirm'], false]
        ]) {
            const dialog = useConfirmDialog();
            const decision = chooseBackupImport(dialog.askConfirm);
            assert.equal(dialog.confirmState.value.alternativeDanger, true);
            for (let index = 0; index < actions.length; index++) {
                if (index) {
                    assert.equal(dialog.confirmState.value.isDanger, true);
                    assert.equal(dialog.confirmState.value.alternativeText, '');
                }
                dialog.confirmState.value[actions[index]]();
                await Promise.resolve();
            }
            assert.equal(await decision, expected);
        }
    });
    await t.test('exporting with lyrics, without lyrics and cancelling are three separate results', async () => {
        const dialog = useConfirmDialog();
        dialog.showConfirm({ isDanger: true, alternativeText: 'Old action' });
        for (const [action, expected] of [['onConfirm', true], ['onAlternative', false], ['onCancel', null]]) {
            const decision = dialog.askConfirm(lyricsExportOptions);
            assert.equal(dialog.confirmState.value.isDanger, false);
            assert.equal(dialog.confirmState.value.cancelText, 'Cancelar');
            dialog.confirmState.value[action]();
            assert.equal(await decision, expected);
        }
        assert.equal(memory.size, 0);
    });

    for (const desktop of [false, true]) {
        await t.test(desktop ? 'desktop filesystem' : 'browser localStorage', async () => {
            let workspace = new Workspace(directory);
            globalThis.window = desktop ? { electronAPI: {
                storage: { getItem: key => workspace.getItem(key), setItem: (key, value) => workspace.setItem(key, value) },
                importDatabase: (json, merge) => workspace.importDatabase(JSON.parse(json), merge),
                refreshWorkspace: () => workspace.reload(),
                exportFile: (name, bytes) => workspace.exportFile(name, bytes)
            } } : {};
            setActivePinia(createPinia());
            let sheet = useSheetStore();
            let collections = useCollectionStore();
            const list = computed(() => sheet.getSongsList());
            sheet.initializeApp();
            assert.equal(list.value.length, 0);
            assert.equal(sheet.settings.font_family, 'Recovered Chords Std');
            assert.equal(sheet.settings.chord_font_family, undefined);
            // One font controls all page text and survives save/reload/import.
            sheet.updateSettings({ font_family: 'Oswald' });
            assert.match(getSheetFontStyles(sheet.settings)['--sheet-font-family'], /Oswald/);
            assert.match(getSheetFontStyles(sheet.settings)['--chord-font-family'], /Oswald/);
            const firstId = sheet.saveSongAs('Primera');
            assert.equal(list.value.length, 1);
            sheet.updateName('Editada');
            assert.equal(sheet.getSongsRegistry().songs[firstId].header.center.top.name, 'Editada');
            sheet.undoLastChange();
            assert.equal(sheet.header.center.top.name, 'Nueva Canción');
            const collectionId = collections.addCollection('Repertorio');
            collections.addSongToCollection(collectionId, firstId);
            sheet.newFile();
            assert.equal(sheet.settings.font_family, 'Recovered Chords Std');
            assert.equal(sheet.settings.chord_font_family, undefined);
            assert.match(getSheetFontStyles(sheet.settings)['--chord-font-family'], /Recovered Chords Std/);
            const secondId = sheet.saveSongAs('Segunda');
            assert.notEqual(firstId, secondId);
            collections.addSongToCollection(collectionId, secondId);
            sheet.importData({ ...sheet.exportData(),
                settings: { ...sheet.settings, font_family: 'Libre Baskerville', chord_font_family: 'Recovered Chords Std' },
                structure: [{ id: 'A' }, { isBreak: true }, { id: 'A', lyric: 'Segunda vuelta' }]
            });
            assert.equal(sheet.settings.font_family, 'Recovered Chords Std');
            assert.equal(sheet.settings.chord_font_family, undefined);
            assert.equal(list.value.length, 2);
            const backup = sheet.exportCompleteDatabase();
            assert.equal(backup.collectionStoreData.length, 1);
            assert.equal(collections.exportCollection(collectionId).songs.length, 2);
            if (desktop) {
                workspace = new Workspace(directory);
                await saveExport(new Blob(['exported bytes']), 'native.gse');
                assert.equal(fs.readFileSync(path.join(directory, 'Exported/native.gse'), 'utf8'), 'exported bytes');
            }
            setActivePinia(createPinia());
            sheet = useSheetStore();
            collections = useCollectionStore();
            collections.loadCollections();
            assert.equal(sheet.getSongsList().length, 2);
            assert.deepEqual([...collections.collections[0].songs], [firstId, secondId]);
            sheet.loadSong(firstId);
            assert.equal(sheet.settings.font_family, 'Oswald');
            assert.equal(sheet.settings.chord_font_family, undefined);
            sheet.loadSong(secondId);
            assert.equal(sheet.settings.font_family, 'Recovered Chords Std');
            assert.equal(sheet.structure[1].isBreak, true);
            assert.equal(sheet.structure[1].id, undefined);
            sheet.updateAuthor('Autor');
            assert.equal(sheet.getSongsRegistry().songs[secondId].header.center.bottom.author, 'Autor');
            assert.equal(sheet.getSongsRegistry().songs[secondId].structure[1].isBreak, true);
            sheet.deleteSong(firstId);
            assert.equal(sheet.getSongsList().length, 1);
            assert.deepEqual(JSON.parse(JSON.stringify(collections.integrityIssues)), [{
                collectionId, name: 'Repertorio', missingSongs: [{ id: firstId, position: 1 }]
            }]);
            assert.throws(() => collections.exportCollection(collectionId), { code: 'MISSING_COLLECTION_SONGS' });
            assert.equal(collections.integrityReportOpen, true);
            assert.deepEqual([...collections.collections[0].songs], [firstId, secondId]);
            assert.deepEqual(sheet.exportCompleteDatabase().collectionStoreData[0].songs, [firstId, secondId]);
            sheet.importCompleteDatabase(backup, false);
            assert.equal(collections.integrityIssues.length, 0);
            assert.equal(sheet.getSongsList().length, 2);
            assert.equal(collections.collections.length, 1);
            assert.equal(collections.exportCollection(collectionId).songs.length, 2);
            sheet.newFile();
            const thirdId = sheet.saveSongAs('Nueva tras restaurar');
            sheet.importCompleteDatabase(backup, true);
            assert.equal(sheet.getSongsList().length, 3);
            assert.ok(sheet.getSongsRegistry().songs[thirdId]);
            if (desktop) {
                assert.equal(fs.readdirSync(path.join(directory, 'Songs')).length, 3);
                assert.equal(fs.readdirSync(path.join(directory, 'Collections')).length, 1);
            } else {
                // Keep a browser backup ready to exercise web -> desktop import below.
                globalThis.browserBackup = backup;
            }
            memory.clear();
        });
    }

    await t.test('web backup import produces desktop files and preserves references', () => {
        const workspace = new Workspace(path.join(directory, 'web-import'));
        globalThis.window = { electronAPI: {
            storage: { getItem: key => workspace.getItem(key), setItem: (key, value) => workspace.setItem(key, value) },
            importDatabase: (json, merge) => workspace.importDatabase(JSON.parse(json), merge)
        } };
        setActivePinia(createPinia());
        const sheet = useSheetStore();
        const collections = useCollectionStore();
        sheet.importCompleteDatabase(globalThis.browserBackup, false);
        assert.equal(fs.readdirSync(workspace.folders.Songs).length, 2);
        assert.equal(fs.readdirSync(workspace.folders.Collections).length, 1);
        assert.equal(collections.exportCollection(collections.collections[0].id).songs.length, 2);
        assert.equal(memory.size, 0);
        delete globalThis.browserBackup;
    });

    for (const desktop of [false, true]) {
        await t.test(desktop ? 'desktop startup, folder changes and exports detect missing files and recover by ID' : 'web startup and imports report missing references and recover by ID', () => {
            let workspace = new Workspace(path.join(directory, 'integrity'));
            globalThis.window = desktop ? { electronAPI: {
                storage: { getItem: key => workspace.getItem(key), setItem: (key, value) => workspace.setItem(key, value) },
                importDatabase: (json, merge) => workspace.importDatabase(JSON.parse(json), merge),
                refreshWorkspace: () => workspace.reload()
            } } : {};
            setActivePinia(createPinia());
            let sheet = useSheetStore();
            let collections = useCollectionStore();
            sheet.initializeApp();
            const id = sheet.saveSongAs('Compartida');
            const complete = collections.addCollection('Completa');
            collections.addSongToCollection(complete, id);
            const incomplete = collections.addCollection('Pendiente');
            collections.updateCollection(incomplete, { songs: [id, 'missing', id, 'missing'] });
            assert.deepEqual(JSON.parse(JSON.stringify(collections.integrityIssues[0].missingSongs)), [
                { id: 'missing', position: 2 }, { id: 'missing', position: 4 }
            ]);
            assert.equal(collections.exportCollection(complete).songs.length, 1);
            const backup = sheet.exportCompleteDatabase();
            setActivePinia(createPinia());
            sheet = useSheetStore();
            collections = useCollectionStore();
            sheet.initializeApp();
            assert.equal(collections.integrityIssues.length, 1);
            assert.throws(() => collections.exportCollection(incomplete), { code: 'MISSING_COLLECTION_SONGS' });
            const incoming = structuredClone(backup);
            incoming.songs.missing = { ...incoming.songs[id], id: 'missing' };
            sheet.importCompleteDatabase(incoming, true);
            assert.deepEqual(collections.integrityIssues, []);
            assert.deepEqual(collections.exportCollection(incomplete).songs.map(song => song.id), [id, 'missing', id, 'missing']);
            if (desktop) {
                const file = workspace.songFiles.get(id);
                const bytes = fs.readFileSync(file);
                fs.unlinkSync(file);
                assert.throws(() => collections.exportCollection(complete), { code: 'MISSING_COLLECTION_SONGS' });
                assert.equal(collections.integrityIssues.length, 2);
                fs.writeFileSync(path.join(workspace.folders.Songs, 'renamed-song.gse'), bytes);
                assert.deepEqual(collections.checkIntegrity(), []);
                assert.equal(collections.exportCollection(complete).songs[0].id, id);
                workspace = new Workspace(path.join(directory, 'another-workspace'));
                workspace.importDatabase(backup, false);
                sheet.initializeApp();
                assert.equal(collections.integrityIssues[0].collectionId, incomplete);
                assert.deepEqual([...collections.collections.find(item => item.id === incomplete).songs], [id, 'missing', id, 'missing']);
            }
            memory.clear();
        });
    }
});
