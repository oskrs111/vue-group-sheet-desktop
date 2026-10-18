const { spawn } = require('node:child_process');
const { getWebRoot } = require('./web-project');

async function develop() {
    const { createServer } = await import('vite');
    const server = await createServer({
        root: getWebRoot(),
        server: { host: '127.0.0.1', port: 5173, open: false }
    });
    let child;
    let stopping;
    function stop(code) {
        if (stopping) return stopping;
        stopping = (async () => {
            process.exitCode = code;
            if (child && child.exitCode === null && !child.killed) child.kill();
            await server.close();
        })();
        return stopping;
    }
    try {
        await server.listen();
        server.printUrls();
        const env = { ...process.env, GSE_DEV_URL: server.resolvedUrls.local[0] };
        delete env.ELECTRON_RUN_AS_NODE;
        child = spawn(require('electron'), ['.'], { cwd: __dirname, env, stdio: 'inherit' });
        child.once('error', error => { console.error(error); void stop(1); });
        child.once('exit', code => { void stop(code ?? 1); });
        process.once('SIGINT', () => { void stop(0); });
        process.once('SIGTERM', () => { void stop(0); });
    } catch (error) {
        await stop(1);
        throw error;
    }
}

develop().catch(error => { console.error(error); process.exitCode = 1; });
