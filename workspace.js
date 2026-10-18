const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const SONGS_KEY = 'groupSheetSongs';
const COLLECTIONS_KEY = 'groupSheetCollections';

function documentStem(record, extension) {
    const fallback = extension === '.gse' ? 'Canción sin título' : 'Colección sin nombre';
    const title = (typeof record.name === 'string' && record.name.trim()) ||
        (typeof record.header?.center?.top?.name === 'string' && record.header.center.top.name.trim()) || fallback;
    const author = extension === '.gse' && record.header?.center?.bottom?.author;
    const label = typeof author === 'string' && author.trim() ? `${title} — ${author.trim()}` : title;
    const cleaned = label.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
    let stem = '';
    for (const character of cleaned) {
        if (Buffer.byteLength(stem + character, 'utf8') > 180) break;
        stem += character;
    }
    stem = stem.replace(/[. ]+$/, '') || fallback;
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i.test(stem)) stem = '_' + stem;
    return stem;
}

function filenameKey(file) {
    return path.basename(file).normalize('NFC').toLowerCase();
}

function isLegacyFilename(file, id, record, extension) {
    if (!file || path.basename(file) === `${documentStem(record, extension)}${extension}`) return false;
    const stem = path.basename(file, path.extname(file));
    return stem === id || stem.toLowerCase() === createHash('sha256').update(id).digest('hex');
}

function atomicWrite(file, content) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, content, { flag: 'wx' });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function validateRecord(record, kind) {
    if (!record || typeof record.id !== 'string' || !record.id.trim()) {
        throw new Error(`Identificador de ${kind} inválido.`);
    }
    if (kind === 'canción') {
        if (!record.header?.left?.top || !record.header?.left?.bottom ||
            !record.header?.center?.top || !record.header?.center?.bottom || !record.header?.right?.top ||
            !Array.isArray(record.body) || !Array.isArray(record.structure) ||
            record.body.some(section => !section || !Array.isArray(section.compass) ||
                section.compass.some(compass => !compass || !Array.isArray(compass.chords))) ||
            record.structure.some(item => !item || (item.isBreak !== true && typeof item.id !== 'string'))) {
            throw new Error(`La canción "${record.id}" no tiene un formato válido.`);
        }
    } else if (!Array.isArray(record.songs) || record.songs.some(id => typeof id !== 'string' || !id)) {
        throw new Error(`La colección "${record.id}" no tiene referencias de canciones válidas.`);
    }
    return record;
}

function databaseCollections(database) {
    const collections = database.collectionStoreData ?? database.collections ?? [];
    if (!collections || typeof collections !== 'object') throw new Error('Colecciones inválidas.');
    return Array.isArray(collections) ? collections : Object.values(collections);
}

function validateDatabase(database) {
    if (!database || ![1, 2, 3, 4].includes(database.version) ||
        !database.songs || typeof database.songs !== 'object' || Array.isArray(database.songs)) {
        throw new Error('Formato o versión de backup no compatible.');
    }
    const songs = new Map();
    for (const [id, song] of Object.entries(database.songs)) {
        validateRecord(song, 'canción');
        if (id !== song.id) throw new Error(`Identificador de canción inconsistente: ${id}.`);
        songs.set(id, {
            ...song,
            body: song.body.map(section => ({ ...section, turns: section.turns ?? 1 })),
            structure: song.structure.map(item => ({ ...item, lyric: item.lyric ?? '', isBreak: item.isBreak ?? false }))
        });
    }
    const collections = new Map();
    for (const collection of databaseCollections(database)) {
        validateRecord(collection, 'colección');
        if (collections.has(collection.id)) throw new Error(`Colección duplicada: ${collection.id}.`);
        collections.set(collection.id, collection);
    }
    return { songs, collections };
}

class Workspace {
    constructor(directory) {
        this.directory = path.resolve(directory);
        this.folders = Object.fromEntries(['Songs', 'Collections', 'Exported', 'Backup'].map(name => {
            const folder = path.join(this.directory, name);
            fs.mkdirSync(folder, { recursive: true });
            return [name, folder];
        }));
        fs.accessSync(this.directory, fs.constants.W_OK);
        this.reload();
        if ([[this.songs, this.songFiles, '.gse'], [this.collections, this.collectionFiles, '.col']]
            .some(([records, files, extension]) => [...files].some(([id, file]) => isLegacyFilename(file, id, records.get(id), extension)))) {
            this.backup();
            this.commit(this.songs, this.collections);
        }
    }

    readRecords(folder, extension, kind) {
        const records = new Map();
        const files = new Map();
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            if (!entry.isFile() || ![extension, '.json'].includes(path.extname(entry.name).toLowerCase())) continue;
            const file = path.join(folder, entry.name);
            let record;
            try {
                record = validateRecord(JSON.parse(fs.readFileSync(file, 'utf8')), kind);
            } catch (error) {
                throw new Error(`No se pudo cargar ${file}: ${error.message}`);
            }
            if (records.has(record.id)) throw new Error(`Identificador duplicado en ${file}: ${record.id}.`);
            records.set(record.id, record);
            files.set(record.id, file);
        }
        return { records, files };
    }

    reload() {
        const songs = this.readRecords(this.folders.Songs, '.gse', 'canción');
        const collections = this.readRecords(this.folders.Collections, '.col', 'colección');
        this.songs = songs.records;
        this.songFiles = songs.files;
        this.collections = collections.records;
        this.collectionFiles = collections.files;
    }

    snapshot() {
        return {
            version: 4,
            songs: Object.fromEntries(this.songs),
            collections: {},
            collectionStoreData: [...this.collections.values()]
        };
    }

    getItem(key) {
        if (key === SONGS_KEY) {
            const { collectionStoreData, ...registry } = this.snapshot();
            return JSON.stringify(registry);
        }
        if (key === COLLECTIONS_KEY) return JSON.stringify([...this.collections.values()]);
        throw new Error('Almacén no permitido.');
    }

    setItem(key, value) {
        const data = JSON.parse(value);
        if (key === SONGS_KEY) {
            const { songs } = validateDatabase({ ...data, collectionStoreData: [] });
            this.commit(songs, this.collections);
        } else if (key === COLLECTIONS_KEY) {
            if (!Array.isArray(data)) throw new Error('Colecciones inválidas.');
            const { collections } = validateDatabase({ version: 4, songs: {}, collectionStoreData: data });
            this.commit(this.songs, collections);
        } else {
            throw new Error('Almacén no permitido.');
        }
    }

    commit(songs, collections) {
        const changes = [];
        const nextFiles = [];
        for (const [next, current, files, folder, extension] of [
            [songs, this.songs, this.songFiles, this.folders.Songs, '.gse'],
            [collections, this.collections, this.collectionFiles, this.folders.Collections, '.col']
        ]) {
            const newFiles = new Map();
            const occupied = new Set(fs.readdirSync(folder).map(filenameKey));
            for (const [id, record] of next) {
                // The identity lives in the document; filenames and absolute paths are never references.
                const previousFile = files.get(id);
                let file = previousFile;
                const stem = documentStem(record, extension);
                if (!file || isLegacyFilename(file, id, record, extension) || (current.has(id) && documentStem(current.get(id), extension) !== stem)) {
                    let number = 1;
                    do {
                        file = path.join(folder, `${stem}${number === 1 ? '' : ` (${number})`}${extension}`);
                        number++;
                    } while (occupied.has(filenameKey(file)) && (!previousFile || filenameKey(file) !== filenameKey(previousFile)));
                }
                occupied.add(filenameKey(file));
                newFiles.set(id, file);
                if (previousFile && previousFile !== file) changes.push({ from: previousFile, file });
                if (JSON.stringify(current.get(id)) !== JSON.stringify(record)) {
                    changes.push({ file, content: JSON.stringify(record, null, 2) });
                }
            }
            for (const [id, file] of files) {
                if (!next.has(id)) changes.push({ file, content: null });
            }
            nextFiles.push(newFiles);
        }

        const applied = [];
        try {
            for (const change of changes) {
                if (change.from) {
                    fs.renameSync(change.from, change.file);
                    applied.push({ from: change.file, file: change.from });
                    continue;
                }
                const previous = fs.existsSync(change.file) ? fs.readFileSync(change.file) : null;
                if (change.content === null) fs.unlinkSync(change.file);
                else atomicWrite(change.file, change.content);
                applied.push({ file: change.file, content: previous });
            }
        } catch (error) {
            for (const change of applied.reverse()) {
                if (change.from) fs.renameSync(change.from, change.file);
                else if (change.content === null) fs.unlinkSync(change.file);
                else atomicWrite(change.file, change.content);
            }
            throw error;
        }
        this.songs = songs;
        this.collections = collections;
        [this.songFiles, this.collectionFiles] = nextFiles;
    }

    importDatabase(database, merge) {
        const incoming = validateDatabase(database);
        const songs = merge ? new Map([...this.songs, ...incoming.songs]) : incoming.songs;
        const collections = merge ? new Map([...this.collections, ...incoming.collections]) : incoming.collections;
        if (this.songs.size || this.collections.size) this.backup();
        this.commit(songs, collections);
    }

    backup() {
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const file = path.join(this.folders.Backup, `GroupSheet_${timestamp}_${randomUUID()}.backup`);
        atomicWrite(file, JSON.stringify(this.snapshot(), null, 2));
        return file;
    }

    exportFile(name, bytes) {
        if (typeof name !== 'string' || !name || name.length > 200 ||
            /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) {
            throw new Error('Nombre de archivo de exportación inválido.');
        }
        const file = path.join(this.folders.Exported, name);
        atomicWrite(file, Buffer.from(bytes));
        return file;
    }
}

module.exports = { Workspace, atomicWrite };
