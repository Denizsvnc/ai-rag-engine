import 'dotenv/config';
import { createIngestionRuntime, persistentVectorsFromEnv, positiveEnv } from './config/ingestion-runtime.js';

async function main() {
    const vectors = persistentVectorsFromEnv();
    await vectors.init();
    const runtime = await createIngestionRuntime(vectors);
    await runtime.worker.start();
    console.log('[IngestionWorker] Ready');
    let stopping = false;
    const stop = async () => {
        if (stopping) return; stopping = true;
        const deadline = setTimeout(() => { console.error('[IngestionWorker] Shutdown timed out'); process.exit(1); }, positiveEnv('SHUTDOWN_TIMEOUT_MS', 30000));
        deadline.unref();
        try { await runtime.close(); await vectors.close(); }
        catch (error) { console.error('[IngestionWorker] Shutdown failed', error); process.exitCode = 1; }
        finally { clearTimeout(deadline); }
    };
    process.once('SIGTERM', () => { void stop(); });
    process.once('SIGINT', () => { void stop(); });
}
main().catch(error => { console.error('[IngestionWorker]', error.message); process.exit(1); });
