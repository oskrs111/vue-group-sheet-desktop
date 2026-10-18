const fs = require('node:fs');
const path = require('node:path');

function getWebRoot() {
    const candidates = [process.env.GSE_WEB_ROOT, path.resolve(__dirname, '..'), path.join(__dirname, 'src/web')].filter(Boolean);
    const root = candidates.find(directory => fs.existsSync(path.join(directory, 'src/utils/persistence.js')));
    if (!root) throw new Error('No se encuentra el editor actualizado. Configura GSE_WEB_ROOT con su carpeta e instala sus dependencias.');
    return path.resolve(root);
}

module.exports = { getWebRoot };
