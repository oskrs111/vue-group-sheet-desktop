const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Workspace } = require('../workspace');
const { Settings } = require('../settings');

function temporary(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gse-workspace-test-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}

function song(id, name = 'Canción') {
    return {
        id, name,
        header: { left: { top: { tempo: '120' }, bottom: { signature: '4/4' } }, center: { top: { name }, bottom: { author: '' } }, right: { top: { tone: 'C' } } },
        body: [{ id: 'A', compass: [{ chords: [{ chord: 'C', div: 3 }] }] }],
        structure: [{ id: 'A' }], notes: [], settings: {}
    };
}

function database(songs = [song('one')], collections = [{ id: 'set', name: 'Directo', songs: songs.map(item => item.id) }]) {
    return { version: 4, songs: Object.fromEntries(songs.map(item => [item.id, item])), collections: {}, collectionStoreData: collections };
}

test('creates four folders and restores individual songs and collections after restart', t => {
    const directory = temporary(t);
    const workspace = new Workspace(directory);
    workspace.importDatabase(database([song('one'), song('two')]), false);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['Backup', 'Collections', 'Exported', 'Songs']);
    assert.equal(fs.readdirSync(workspace.folders.Songs).length, 2);
    assert.equal(fs.readdirSync(workspace.folders.Collections).length, 1);
    const restored = new Workspace(directory).snapshot();
    assert.deepEqual(Object.keys(restored.songs).sort(), ['one', 'two']);
    assert.deepEqual(restored.collectionStoreData[0].songs, ['one', 'two']);
});

test('imports readable song and collection filenames while keeping internal IDs and references', t => {
    const workspace = new Workspace(temporary(t));
    const incoming = database([song('one', 'Sweet Home Chicago'), song('two', 'Canción sin autor')]);
    incoming.songs.one.header.center.bottom.author = 'The Blues Brothers';
    incoming.collectionStoreData[0].name = 'Concierto de otoño';
    workspace.importDatabase(incoming, false);
    assert.deepEqual(fs.readdirSync(workspace.folders.Songs).sort(), ['Canción sin autor.gse', 'Sweet Home Chicago — The Blues Brothers.gse']);
    assert.deepEqual(fs.readdirSync(workspace.folders.Collections), ['Concierto de otoño.col']);
    assert.equal(new Workspace(workspace.directory).snapshot().songs.one.id, 'one');
    assert.deepEqual(workspace.snapshot().collectionStoreData[0].songs, ['one', 'two']);
});

test('duplicate names get stable numbered suffixes without overwriting files or directories', t => {
    const workspace = new Workspace(temporary(t));
    fs.mkdirSync(path.join(workspace.folders.Songs, 'Canción.gse'));
    workspace.importDatabase(database([song('one'), song('two', 'CANCIÓN')], [
        { id: 'first', name: 'Directo', songs: ['one'] },
        { id: 'second', name: 'DIRECTO', songs: ['two'] }
    ]), false);
    assert.equal(path.basename(workspace.songFiles.get('one')), 'Canción (2).gse');
    assert.equal(path.basename(workspace.songFiles.get('two')), 'CANCIÓN (3).gse');
    assert.deepEqual(fs.readdirSync(workspace.folders.Collections).sort(), ['DIRECTO (2).col', 'Directo.col']);
    const names = [...workspace.songFiles.values()];
    workspace.importDatabase(workspace.snapshot(), true);
    assert.deepEqual([...workspace.songFiles.values()], names);
    assert.ok(fs.statSync(path.join(workspace.folders.Songs, 'Canción.gse')).isDirectory());
});

test('filenames retain accents, sanitize unsafe names and stay within portable length limits', t => {
    const workspace = new Workspace(temporary(t));
    const incoming = database([
        song('one', '../Canción: "Ñandú" / ensayo?*'), song('two', 'CON'),
        song('three', '🎵'.repeat(200)), song('four', '...')
    ], [{ id: 'set', name: 'NUL', songs: ['one', 'two', 'three', 'four'] }]);
    workspace.importDatabase(incoming, false);
    assert.match(path.basename(workspace.songFiles.get('one')), /Canción.*Ñandú/);
    assert.equal(path.basename(workspace.songFiles.get('two')), '_CON.gse');
    assert.equal(path.basename(workspace.collectionFiles.get('set')), '_NUL.col');
    for (const file of [...workspace.songFiles.values(), ...workspace.collectionFiles.values()]) {
        const name = path.basename(file);
        assert.ok(Buffer.byteLength(name) < 220);
        assert.ok(!/[<>:"/\\|?*\x00-\x1f]/.test(name));
        assert.ok([workspace.folders.Songs, workspace.folders.Collections].includes(path.dirname(file)));
    }
    assert.equal(new Workspace(workspace.directory).songs.size, 4);
});

test('editing titles and authors renames files; external custom filenames survive other edits', t => {
    const workspace = new Workspace(temporary(t));
    workspace.importDatabase(database([song('one', 'Original')]), false);
    fs.renameSync(workspace.songFiles.get('one'), path.join(workspace.folders.Songs, 'Nombre elegido por mí.gse'));
    fs.renameSync(workspace.collectionFiles.get('set'), path.join(workspace.folders.Collections, 'Mi repertorio.col'));
    workspace.reload();
    const registry = JSON.parse(workspace.getItem('groupSheetSongs'));
    registry.songs.one.header.left.top.tempo = '90';
    workspace.setItem('groupSheetSongs', JSON.stringify(registry));
    assert.equal(path.basename(workspace.songFiles.get('one')), 'Nombre elegido por mí.gse');
    assert.equal(path.basename(workspace.collectionFiles.get('set')), 'Mi repertorio.col');
    registry.songs.one.name = 'Renombrada';
    registry.songs.one.header.center.bottom.author = 'Autor';
    workspace.setItem('groupSheetSongs', JSON.stringify(registry));
    assert.deepEqual(fs.readdirSync(workspace.folders.Songs), ['Renombrada — Autor.gse']);
    workspace.setItem('groupSheetCollections', JSON.stringify([{ id: 'set', name: 'Nuevo repertorio', songs: ['one'] }]));
    assert.deepEqual(fs.readdirSync(workspace.folders.Collections), ['Nuevo repertorio.col']);
    assert.deepEqual(new Workspace(workspace.directory).collections.get('set').songs, ['one']);
});

test('case-only title changes keep a single file and the same ID', t => {
    const workspace = new Workspace(temporary(t));
    workspace.importDatabase(database([song('one', 'Original')]), false);
    const registry = JSON.parse(workspace.getItem('groupSheetSongs'));
    registry.songs.one.name = 'ORIGINAL';
    workspace.setItem('groupSheetSongs', JSON.stringify(registry));
    assert.deepEqual(fs.readdirSync(workspace.folders.Songs), ['ORIGINAL.gse']);
    assert.equal(new Workspace(workspace.directory).songs.get('one').name, 'ORIGINAL');
});

test('readable filenames that happen to match IDs do not create migration backups on each startup', t => {
    const workspace = new Workspace(temporary(t));
    workspace.importDatabase(database([song('Título', 'Título')], [{ id: 'Directo', name: 'Directo', songs: ['Título'] }]), false);
    new Workspace(workspace.directory);
    new Workspace(workspace.directory);
    assert.deepEqual(fs.readdirSync(workspace.folders.Backup), []);
});

test('startup migrates legacy hashes and ID filenames once, backs up first and preserves custom names', t => {
    const directory = temporary(t);
    const initial = new Workspace(directory);
    const originalSong = song('one', 'Canción');
    const customSong = song('two', 'También se llama Canción');
    const originalCollection = { id: 'set', name: 'Directo', songs: ['two', 'one', 'missing'] };
    const legacyName = createHash('sha256').update('one').digest('hex') + '.gse';
    fs.writeFileSync(path.join(initial.folders.Songs, legacyName), JSON.stringify(originalSong));
    fs.writeFileSync(path.join(initial.folders.Songs, 'Canción.gse'), JSON.stringify(customSong));
    fs.writeFileSync(path.join(initial.folders.Collections, 'set.col'), JSON.stringify(originalCollection));
    const workspace = new Workspace(directory);
    assert.deepEqual(fs.readdirSync(workspace.folders.Songs).sort(), ['Canción (2).gse', 'Canción.gse']);
    assert.deepEqual(fs.readdirSync(workspace.folders.Collections), ['Directo.col']);
    const backups = fs.readdirSync(workspace.folders.Backup);
    assert.equal(backups.length, 1);
    const backup = JSON.parse(fs.readFileSync(path.join(workspace.folders.Backup, backups[0])));
    assert.deepEqual(backup.songs.one, originalSong);
    assert.deepEqual(backup.collectionStoreData[0], originalCollection);
    assert.equal(fs.readFileSync(path.join(workspace.folders.Songs, 'Canción (2).gse'), 'utf8'), JSON.stringify(originalSong));
    assert.deepEqual(new Workspace(directory).snapshot(), workspace.snapshot());
    assert.equal(fs.readdirSync(workspace.folders.Backup).length, 1);
});

test('failed legacy renaming restores original filenames and keeps the recovery backup', t => {
    const initial = new Workspace(temporary(t));
    const originalSong = song('one');
    const originalCollection = { id: 'set', name: 'Directo', songs: ['one'] };
    const oldSongFile = path.join(initial.folders.Songs, createHash('sha256').update('one').digest('hex') + '.gse');
    const oldCollectionFile = path.join(initial.folders.Collections, 'set.col');
    fs.writeFileSync(oldSongFile, JSON.stringify(originalSong));
    fs.writeFileSync(oldCollectionFile, JSON.stringify(originalCollection));
    const rename = fs.renameSync;
    let documentRenames = 0;
    fs.renameSync = (from, to) => {
        if (path.extname(from) !== '.tmp' && ++documentRenames === 2) throw new Error('Rename denied');
        return rename(from, to);
    };
    try {
        assert.throws(() => new Workspace(initial.directory), /Rename denied/);
    } finally {
        fs.renameSync = rename;
    }
    assert.deepEqual(fs.readdirSync(initial.folders.Songs), [path.basename(oldSongFile)]);
    assert.deepEqual(fs.readdirSync(initial.folders.Collections), ['set.col']);
    assert.deepEqual(JSON.parse(fs.readFileSync(oldSongFile)), originalSong);
    assert.equal(fs.readdirSync(initial.folders.Backup).length, 1);
});

test('moving and renaming files preserves ordered ID references and missing references', t => {
    const directory = temporary(t);
    const workspace = new Workspace(path.join(directory, 'computer-one'));
    workspace.importDatabase(database([song('one'), song('two')], [{ id: 'set', name: 'Set', songs: ['two', 'missing', 'one'] }]), false);
    const destination = path.join(directory, 'computer-two');
    fs.cpSync(workspace.directory, destination, { recursive: true });
    for (const folder of ['Songs', 'Collections']) {
        const files = fs.readdirSync(path.join(destination, folder));
        fs.renameSync(path.join(destination, folder, files[0]), path.join(destination, folder, `renamed${path.extname(files[0])}`));
    }
    const moved = new Workspace(destination);
    assert.deepEqual(moved.snapshot().collectionStoreData[0].songs, ['two', 'missing', 'one']);
    assert.equal(moved.snapshot().songs.two.id, 'two');
    assert.equal(moved.snapshot().songs.one.id, 'one');
});

test('editing only writes the changed song; deleting does not remove unrelated files', t => {
    const workspace = new Workspace(temporary(t));
    workspace.importDatabase(database([song('one'), song('two')]), false);
    const songFiles = fs.readdirSync(workspace.folders.Songs).map(name => path.join(workspace.folders.Songs, name));
    const secondFile = songFiles.find(file => JSON.parse(fs.readFileSync(file)).id === 'two');
    fs.utimesSync(secondFile, new Date(100000), new Date(100000));
    const registry = JSON.parse(workspace.getItem('groupSheetSongs'));
    registry.songs.one.name = 'Editada';
    workspace.setItem('groupSheetSongs', JSON.stringify(registry));
    assert.equal(fs.statSync(secondFile).mtimeMs, 100000);
    fs.writeFileSync(path.join(workspace.folders.Songs, 'notes.txt'), 'Keep');
    delete registry.songs.one;
    workspace.setItem('groupSheetSongs', JSON.stringify(registry));
    assert.deepEqual(Object.keys(new Workspace(workspace.directory).snapshot().songs), ['two']);
    assert.equal(fs.readFileSync(path.join(workspace.folders.Songs, 'notes.txt'), 'utf8'), 'Keep');
});

test('web backups split into files; merge and replace retain IDs and make a recovery copy', t => {
    const workspace = new Workspace(temporary(t));
    workspace.importDatabase(database([song('one')]), false);
    workspace.importDatabase(database([song('two')], [{ id: 'other', name: 'Otro', songs: ['two', 'one'] }]), true);
    assert.equal(workspace.songs.size, 2);
    assert.equal(workspace.collections.size, 2);
    const beforeReplace = workspace.snapshot();
    workspace.importDatabase(database([song('replacement')]), false);
    assert.deepEqual(Object.keys(workspace.snapshot().songs), ['replacement']);
    assert.equal(fs.readdirSync(workspace.folders.Songs).length, 1);
    const backups = fs.readdirSync(workspace.folders.Backup).map(file => JSON.parse(fs.readFileSync(path.join(workspace.folders.Backup, file))));
    assert.ok(backups.some(backup => JSON.stringify(backup) === JSON.stringify(beforeReplace)));
    const target = new Workspace(path.join(workspace.directory, 'restored'));
    target.importDatabase(beforeReplace, false);
    assert.deepEqual(target.snapshot(), beforeReplace);
});

test('accepts legacy collection maps and upgrades older web song fields', t => {
    const workspace = new Workspace(temporary(t));
    const incoming = database();
    incoming.version = 1;
    incoming.collections = { set: incoming.collectionStoreData[0] };
    delete incoming.collectionStoreData;
    workspace.importDatabase(incoming, false);
    assert.equal(workspace.snapshot().songs.one.body[0].turns, 1);
    assert.equal(workspace.snapshot().songs.one.structure[0].isBreak, false);
    assert.equal(workspace.collections.get('set').songs[0], 'one');
});

test('web structure line breaks without section IDs survive import, reload and backup', t => {
    const workspace = new Workspace(temporary(t));
    const incoming = database();
    incoming.songs.one.structure = [{ id: 'A' }, { isBreak: true }, { id: 'A', lyric: 'Segunda vuelta' }];
    const original = JSON.stringify(incoming);
    workspace.importDatabase(incoming, false);
    const expected = [
        { id: 'A', lyric: '', isBreak: false },
        { isBreak: true, lyric: '' },
        { id: 'A', lyric: 'Segunda vuelta', isBreak: false }
    ];
    assert.equal(JSON.stringify(incoming), original);
    assert.deepEqual(new Workspace(workspace.directory).snapshot().songs.one.structure, expected);
    assert.deepEqual(workspace.snapshot().collectionStoreData[0].songs, ['one']);
    const backup = JSON.parse(fs.readFileSync(workspace.backup(), 'utf8'));
    const restored = new Workspace(path.join(workspace.directory, 'restored'));
    restored.importDatabase(backup, false);
    assert.deepEqual(restored.snapshot(), workspace.snapshot());
});

test('structure entries still require a section ID unless they are explicit line breaks', t => {
    const workspace = new Workspace(temporary(t));
    workspace.importDatabase(database(), false);
    const before = workspace.snapshot();
    for (const item of [null, {}, { isBreak: false }, { isBreak: 'true' }, { isBreak: 1 }]) {
        const incoming = database([song('two')]);
        incoming.songs.two.structure = [item];
        assert.throws(() => workspace.importDatabase(incoming, false), /formato válido/);
        assert.deepEqual(workspace.snapshot(), before);
    }
});

test('invalid imports and corrupt files fail without erasing saved data', t => {
    const workspace = new Workspace(temporary(t));
    workspace.importDatabase(database(), false);
    const before = workspace.snapshot();
    const invalid = database([song('two')], [{ id: 'broken', songs: [42] }]);
    assert.throws(() => workspace.importDatabase(invalid, false), /referencias/);
    assert.deepEqual(workspace.snapshot(), before);
    fs.writeFileSync(path.join(workspace.folders.Songs, 'broken.gse'), '{');
    assert.throws(() => new Workspace(workspace.directory), /broken.gse/);
    assert.equal(fs.readdirSync(workspace.folders.Songs).length, 2);
});

test('a disk failure rolls back a multi-file update', t => {
    const workspace = new Workspace(temporary(t));
    workspace.importDatabase(database([song('one'), song('two')]), false);
    const before = workspace.snapshot();
    const update = structuredClone(before);
    update.songs.one.name = 'Changed one';
    update.songs.two.name = 'Changed two';
    const original = fs.renameSync;
    let writes = 0;
    fs.renameSync = (...args) => {
        if (++writes === 2) throw new Error('Disk full');
        return original(...args);
    };
    try {
        assert.throws(() => workspace.setItem('groupSheetSongs', JSON.stringify(update)), /Disk full/);
    } finally {
        fs.renameSync = original;
    }
    assert.deepEqual(new Workspace(workspace.directory).snapshot(), before);
    assert.ok(fs.readdirSync(workspace.folders.Songs).every(name => name.endsWith('.gse')));
});

test('binary exports stay in Exported and unsafe filenames are rejected', t => {
    const workspace = new Workspace(temporary(t));
    const bytes = new Uint8Array([0, 255, 13, 10]);
    const file = workspace.exportFile('Canción.pdf', bytes);
    assert.equal(path.dirname(file), workspace.folders.Exported);
    assert.deepEqual(fs.readFileSync(file), Buffer.from(bytes));
    for (const name of ['../escape.json', '..\\escape.json', 'C:\\escape.json', 'NUL.pdf', '.', 'file.']) {
        assert.throws(() => workspace.exportFile(name, bytes), /inválido/);
    }
});

test('imported identities cannot become filesystem paths', t => {
    const workspace = new Workspace(temporary(t));
    const id = '../../outside';
    workspace.importDatabase(database([song(id)], [{ id: '../set', name: 'Portable', songs: [id] }]), false);
    assert.equal(new Workspace(workspace.directory).snapshot().songs[id].id, id);
    assert.equal(fs.readdirSync(workspace.folders.Songs).length, 1);
    assert.deepEqual(fs.readdirSync(workspace.directory).sort(), ['Backup', 'Collections', 'Exported', 'Songs']);
});

test('machine settings default to five minutes, persist changes, and reject invalid intervals', t => {
    const directory = temporary(t);
    const settings = new Settings(directory);
    assert.equal(settings.value.backupMinutes, 5);
    settings.save({ workspace: directory, backupMinutes: 10 });
    assert.deepEqual(new Settings(directory).value, { workspace: directory, backupMinutes: 10 });
    settings.save({ backupMinutes: 0 });
    for (const backupMinutes of [-1, 1.5, '', 1441, null]) {
        assert.throws(() => settings.save({ backupMinutes }), /intervalo/);
    }
    assert.equal(new Settings(directory).value.backupMinutes, 0);
});

test('invalid machine settings can be reconfigured while keeping the original file', t => {
    const directory = temporary(t);
    fs.writeFileSync(path.join(directory, 'workspace-settings.json'), '{broken');
    const settings = new Settings(directory);
    assert.ok(settings.loadError);
    assert.equal(settings.value.backupMinutes, 5);
    settings.save({ workspace: directory });
    const original = fs.readdirSync(directory).find(name => name.endsWith('.invalid'));
    assert.equal(fs.readFileSync(path.join(directory, original), 'utf8'), '{broken');
    assert.equal(new Settings(directory).value.workspace, directory);
});
