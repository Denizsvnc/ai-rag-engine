import 'dotenv/config';
import { Pool } from 'pg';
import { PostgresVectorAdapter } from '../adapters/vector/postgres-vector.adapter.js';
import { PostgresIngestionStore } from '../core/ingestion/postgres-ingestion-store.js';

const role = process.env.RUNTIME_DB_USER;
const password = process.env.RUNTIME_DB_PASSWORD;
if (role && (!/^[a-z][a-z0-9_]{0,39}$/.test(role) || !password || password.length < 32)) throw new Error('Runtime role requires a safe name and a 32+ character password.');
const table = process.env.VECTOR_TABLE_NAME || 'rag_documents';
const ingestion = process.env.INGESTION_TABLE_NAME || 'rag_ingestion';
const store = new PostgresVectorAdapter({
    connectionString: process.env.DATABASE_URL, tableName: table,
    modelName: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS || 384), autoMigrate: true
});
try {
    await store.init();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        await new PostgresIngestionStore(pool, ingestion).migrate();
        if (role) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
                    const sql = await client.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS statement", [role, password]);
                    await client.query(sql.rows[0].statement);
                }
                await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
                await client.query(`GRANT SELECT ON "${table}_config" TO "${role}"`);
                await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON "${table}","${table}_epochs","${table}_manifests","${ingestion}","${ingestion}_heads" TO "${role}"`);
                await client.query('COMMIT');
            } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
            finally { client.release(); }
        }
    } finally { await pool.end(); }
    console.log('Vector and ingestion schemas initialized. Runtime privileges configured when requested.');
} finally { await store.close(); }
