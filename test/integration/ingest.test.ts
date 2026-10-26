import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { RAGEngine } from '../../src/core/engine';
import { MemoryVectorAdapter } from '../../src/adapters/vector/memory-vector.adapter';
import { SMLEngine } from '../../src/core/sml-engine';
import { DocumentIngestionService } from '../../src/services/document-ingestion.service';
import { createApiRoutes } from '../../src/api/routes';
import { createAuthToken } from '../../src/api/auth';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../src/interfaces/llm.interface';

class MockLLMProvider implements ILLMProvider {
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        return {
            content: 'Mock answer',
            usage: { promptTokens: 10, completionTokens: 5 }
        };
    }
}

test('Integration - Document Ingestion & PII Protection Pipeline', async (t) => {
    const smlEngine = new SMLEngine();
    const vectorStore = new MemoryVectorAdapter(smlEngine);

    const engine = new RAGEngine({
        llmProvider: new MockLLMProvider(),
        inputs: { vectorStore },
        cache: { enabled: false },
        smlConfig: { enabled: true }
    });

    await engine.init();

    await t.test('should strictly reject dangerous file extensions and executable magic bytes', () => {
        // Rejects by extension
        const exeCheck = DocumentIngestionService.validateFileSafety('malware.exe', Buffer.from('hello'));
        assert.equal(exeCheck.safe, false);
        assert.ok(exeCheck.reason?.includes('.exe'));

        const shCheck = DocumentIngestionService.validateFileSafety('script.sh', Buffer.from('#!/bin/bash'));
        assert.equal(shCheck.safe, false);

        // Rejects by magic bytes even if disguised with .txt extension
        // MZ header (Windows PE)
        const mzBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00]);
        const disguisedCheck = DocumentIngestionService.validateFileSafety('fake_document.txt', mzBuffer);
        assert.equal(disguisedCheck.safe, false);
        assert.ok(disguisedCheck.reason?.includes('MZ'));

        // ELF header (Linux binary)
        const elfBuffer = Buffer.from([0x7F, 0x45, 0x4C, 0x46]);
        const elfCheck = DocumentIngestionService.validateFileSafety('notes.pdf', elfBuffer);
        assert.equal(elfCheck.safe, false);
        assert.ok(elfCheck.reason?.includes('ELF'));

        // Accepts valid text and pdf
        const validTxt = DocumentIngestionService.validateFileSafety('readme.txt', Buffer.from('Company policy'));
        assert.equal(validTxt.safe, true);

        const validPdf = DocumentIngestionService.validateFileSafety('contract.pdf', Buffer.from('%PDF-1.4 sample content'));
        assert.equal(validPdf.safe, true);
    });

    await t.test('should chunk long documents with natural boundaries and overlap', () => {
        const longText = 'First paragraph with some introduction.\n\nSecond paragraph describing our services in detail.\n\nThird paragraph concluding the document.';
        const chunks = DocumentIngestionService.chunkText(longText, 50, 10);
        assert.ok(chunks.length >= 2);
    });

    await t.test('should ingest text document, redact TCKN & Credit Card, and index chunks into vector store', async () => {
        const sensitiveDoc = 
            'Gizlilik Protokolü:\n' +
            'Müşteri Mehmet Bey, T.C. Kimlik No: 10000000146 ve Kredi Kartı: 4532-0150-1234-5671 ile ödeme yapmıştır. ' +
            'İletişim için mehmet.yilmaz@kurumsal.com adresini kullanabilirsiniz.';

        const { jobId, status } = await engine.ingestDocument({
            filename: 'gizli_sozlesme.txt',
            content: sensitiveDoc
        });

        assert.equal(status, 'queued');

        // Poll job until completed (worker processes asynchronously)
        let job = await engine.getIngestionStatus(jobId);
        let retries = 0;
        while (job?.status !== 'completed' && retries < 20) {
            await new Promise((res) => setTimeout(res, 50));
            job = await engine.getIngestionStatus(jobId);
            retries++;
        }

        assert.equal(job?.status, 'completed');
        assert.ok(job.result);
        assert.ok(job.result.chunksCount > 0);
        assert.ok(job.result.piiEntitiesMasked >= 2, 'Should mask TCKN and Credit Card');

        // Verify stored vectors in vectorStore
        const searchResults = await vectorStore.search('Gizlilik Protokolü Mehmet Bey');
        assert.ok(searchResults.length > 0);
        const indexedContent = searchResults[0]!.content;

        // Verify PII is masked in the vector index
        assert.ok(!indexedContent.includes('10000000146'), 'TCKN must NEVER be in vector store');
        assert.ok(!indexedContent.includes('4532-0150-1234-5671'), 'Credit Card must NEVER be in vector store');
        assert.ok(indexedContent.includes('[TCKN_'));
        assert.ok(indexedContent.includes('[CARD_'));
    });

    await t.test('API endpoints: POST /api/ingest and GET /api/ingest/status/:jobId', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api', createApiRoutes(engine));

        const server = app.listen(0);
        const port = (server.address() as any).port;
        const baseUrl = `http://127.0.0.1:${port}/api`;

        const adminToken = createAuthToken({
            userId: 'test-admin',
            tenantId: 'default',
            roles: ['admin', 'editor']
        });

        try {
            // 1. Submit valid document via API
            const postRes = await fetch(`${baseUrl}/ingest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify({
                    filename: 'sirket_politikasi.md',
                    content: '# Şirket İade Politikası\n14 gün içinde koşulsuz iade hakkı mevcuttur.'
                })
            });

            assert.equal(postRes.status, 202);
            const postBody = await postRes.json() as any;
            assert.ok(postBody.jobId);
            assert.equal(postBody.status, 'queued');

            // 2. Poll status endpoint
            await new Promise((res) => setTimeout(res, 80));
            const statusRes = await fetch(`${baseUrl}/ingest/status/${postBody.jobId}`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            assert.equal(statusRes.status, 200);
            const statusBody = await statusRes.json() as any;
            assert.ok(statusBody.status === 'completed' || statusBody.status === 'processing');

            // 3. Reject dangerous file via API
            const badRes = await fetch(`${baseUrl}/ingest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify({
                    filename: 'exploit.sh',
                    content: '#!/bin/bash\nrm -rf /'
                })
            });

            assert.equal(badRes.status, 400);
            const badBody = await badRes.json() as any;
            assert.ok(badBody.error?.includes('rejected'));

            // 4. Verify GET /api/metrics endpoint
            const metricsRes = await fetch(`${baseUrl}/metrics`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            assert.equal(metricsRes.status, 200);
            const metricsBody = await metricsRes.json() as any;
            assert.ok(typeof metricsBody.totalQueries === 'number');
            assert.ok(typeof metricsBody.tokensSaved === 'number');
        } finally {
            server.close();
        }
    });
});
