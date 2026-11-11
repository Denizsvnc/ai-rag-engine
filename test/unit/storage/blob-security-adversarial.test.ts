import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LocalFsBlobStore } from '../../../src/adapters/blob/local-fs-blob.adapter.js';

describe('LocalFsBlobStore Security Hardening & Adversarial Defenses (Phase 9)', () => {
    let tempDir: string;
    let store: LocalFsBlobStore;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-blob-test-'));
        store = new LocalFsBlobStore({ baseDir: tempDir });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    it('rejects invalid or forged tenant IDs', async () => {
        const invalidTenants = [
            '../escaped',
            '../../root',
            'tenant/sub',
            'tenant\\back',
            '',
            '   ',
            'tenant$evil',
            'tenant.dot',
            'tenant\0null'
        ];

        for (const t of invalidTenants) {
            await assert.rejects(
                store.put('file.pdf', Buffer.from('data'), t),
                /Invalid tenantId/
            );
        }
    });

    it('rejects path traversal attempts in blob keys', async () => {
        const maliciousKeys = [
            '../secret.txt',
            '../../etc/passwd',
            '/absolute/path',
            'sub/../../outside.txt',
            'docs/../../../etc/hosts',
            'foo\0bar.pdf',
            '..\\windows\\traversal'
        ];

        for (const k of maliciousKeys) {
            await assert.rejects(
                store.put(k, Buffer.from('data'), 'tenant_safe'),
                /Path traversal/
            );
        }
    });

    it('blocks symlink traversal on target file write and read', async () => {
        const tenant = 'tenant_symlink';
        const tenantDir = path.join(tempDir, tenant);
        await fs.mkdir(tenantDir, { recursive: true });

        // Create a sensitive file outside tenant folder
        const sensitiveTarget = path.join(tempDir, 'sensitive.txt');
        await fs.writeFile(sensitiveTarget, 'SUPER_SECRET_TOKEN');

        // Create a symlink inside tenant folder pointing to the sensitive file
        const symlinkPath = path.join(tenantDir, 'evil_link.txt');
        await fs.symlink(sensitiveTarget, symlinkPath);

        // Put should reject writing to an existing symlink
        await assert.rejects(
            store.put('evil_link.txt', Buffer.from('overwrite'), tenant),
            /forbidden symlink/
        );

        // Get should reject reading through a symlink
        await assert.rejects(
            store.get('evil_link.txt', tenant),
            /forbidden symlink/
        );
    });

    it('blocks symlink traversal in directory ancestor tree', async () => {
        const tenant = 'tenant_tree';
        const tenantDir = path.join(tempDir, tenant);
        await fs.mkdir(tenantDir, { recursive: true });

        const outsideDir = path.join(tempDir, 'outside_folder');
        await fs.mkdir(outsideDir, { recursive: true });

        // Symlink a directory
        const linkedDir = path.join(tenantDir, 'linked_dir');
        await fs.symlink(outsideDir, linkedDir);

        await assert.rejects(
            store.put('linked_dir/stolen.txt', Buffer.from('content'), tenant),
            /Symlink traversal detected/
        );
    });

    it('safely handles legitimate hierarchical keys with strict tenant isolation', async () => {
        const t1 = 'tenant_1';
        const t2 = 'tenant_2';
        const data1 = Buffer.from('Report for Tenant 1');
        const data2 = Buffer.from('Report for Tenant 2');

        await store.put('finance/2026/q1_report.pdf', data1, t1);
        await store.put('finance/2026/q1_report.pdf', data2, t2);

        const read1 = await store.get('finance/2026/q1_report.pdf', t1);
        const read2 = await store.get('finance/2026/q1_report.pdf', t2);

        assert.equal(read1?.toString(), 'Report for Tenant 1');
        assert.equal(read2?.toString(), 'Report for Tenant 2');

        // Tenant 1 cannot access Tenant 2 unique doc
        await store.put('secret_doc.pdf', Buffer.from('T2 private'), t2);
        const crossRead = await store.get('secret_doc.pdf', t1);
        assert.equal(crossRead, null);
    });
});
