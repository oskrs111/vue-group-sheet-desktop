const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./workspace');

class Settings {
    constructor(directory) {
        fs.mkdirSync(directory, { recursive: true });
        this.file = path.join(directory, 'workspace-settings.json');
        this.value = { workspace: null, backupMinutes: 5 };
        if (fs.existsSync(this.file)) {
            try {
                const value = { ...this.value, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
                this.validate(value);
                this.value = value;
            } catch (error) {
                this.loadError = error;
            }
        }
    }

    validate(value) {
        if (value.workspace !== null && (typeof value.workspace !== 'string' || !path.isAbsolute(value.workspace))) {
            throw new Error('La carpeta de trabajo configurada no es válida.');
        }
        if (!Number.isInteger(value.backupMinutes) || value.backupMinutes < 0 || value.backupMinutes > 1440) {
            throw new Error('El intervalo debe ser un número entero entre 0 y 1440 minutos.');
        }
    }

    save(changes) {
        const value = { ...this.value, ...changes };
        this.validate(value);
        if (this.loadError) fs.copyFileSync(this.file, `${this.file}.${Date.now()}.invalid`);
        atomicWrite(this.file, JSON.stringify(value, null, 2));
        this.value = value;
        this.loadError = null;
        return { ...value };
    }
}

module.exports = { Settings };
