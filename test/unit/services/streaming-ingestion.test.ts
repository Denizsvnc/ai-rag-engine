import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';
import { DocumentIngestionService } from '../../../src/services/document-ingestion.service';
import type { IVectorStoreAdapter, VectorDocument } from '../../../src/interfaces/vector.interface';

class MockVectorStore implements IVectorStoreAdapter {
    public documents: VectorDocument[] = [];

    async search(): Promise<VectorDocument[]> {
        return this.documents;
    }

    async addDocuments(docs: VectorDocument[]): Promise<void> {
        this.documents.push(...docs);
    }
}

describe('Streaming Ingestion & Backpressure Management', () => {
    test('validateStreamSafety should accept clean text stream and preserve initial stream content', async () => {
        const textContent = 'This is safe enterprise documentation for the streaming pipeline.';
        const stream = Readable.from([Buffer.from(textContent)]);

        const result = await DocumentIngestionService.validateStreamSafety('policy.txt', stream);
        assert.strictEqual(result.safe, true);

        // Verify the unshifted safeStream still emits the complete original text
        const chunks: Buffer[] = [];
        for await (const chunk of result.safeStream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const restored = Buffer.concat(chunks).toString('utf-8');
        assert.strictEqual(restored, textContent);
    });

    test('validateStreamSafety should immediately reject malicious stream with executable header without memory bloat', async () => {
        // Construct stream beginning with MZ (Windows DOS executable header)
        const maliciousHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
        const stream = Readable.from([maliciousHeader]);

        const result = await DocumentIngestionService.validateStreamSafety('report.pdf', stream);
        assert.strictEqual(result.safe, false);
        assert.ok(result.reason?.includes('Windows/DOS executable header'));
    });

    test('chunkStream generator should process chunks with natural backpressure and correct overlap', async () => {
        // Simulate a multi-chunk stream of text arriving in arbitrary piece sizes
        const pieces = [
            'Section 1: Enterprise architecture and retrieval governance. ',
            'Section 2: High-throughput ingestion with zero-token caching. ',
            'Section 3: Security safeguards and prompt injection defense.'
        ];
        const stream = Readable.from(pieces);

        const chunks: string[] = [];
        for await (const chunk of DocumentIngestionService.chunkStream(stream, 70, 15)) {
            chunks.push(chunk);
        }

        assert.ok(chunks.length >= 3, `Expected at least 3 chunks, got ${chunks.length}`);
        assert.ok(chunks[0]!.includes('Section 1'));
    });

    test('ingestStreamDirect should stream, mask PII, and insert chunks directly into vector store', async () => {
        const vectorStore = new MockVectorStore();
        const service = new DocumentIngestionService({
            vectorStore,
            chunkSize: 80,
            chunkOverlap: 10
        });

        const sensitiveText = 'Customer TC Kimlik No is 10000000146 and order ID is ORD-99482716382 for billing.';
        const stream = Readable.from([sensitiveText]);

        const result = await service.ingestStreamDirect('customer_info.txt', stream, {
            tenantId: 'tenant_enterprise'
        });

        assert.strictEqual(result.filename, 'customer_info.txt');
        assert.ok(result.chunksCount > 0);
        assert.strictEqual(result.piiEntitiesMasked, 1); // 10000000146 should be masked
        assert.strictEqual(vectorStore.documents.length, result.chunksCount);
        assert.ok(vectorStore.documents[0]!.content.includes('[TCKN_100*****46]'));
        assert.strictEqual(vectorStore.documents[0]!.metadata?.['tenantId'], 'tenant_enterprise');
    });

    test('submitStream should spool stream to temporary storage and process through background queue', async () => {
        const vectorStore = new MockVectorStore();
        const service = new DocumentIngestionService({
            vectorStore,
            chunkSize: 100,
            chunkOverlap: 20
        });

        const stream = Readable.from(['Asynchronous queue ingestion via backpressure spooled stream.']);
        const submission = await service.submitStream('stream_manual.txt', stream, {
            tenantId: 'tenant_async'
        });

        assert.ok(submission.jobId.startsWith('stream_'));

        // Wait briefly for the in-memory queue worker to finish processing
        await new Promise(resolve => setTimeout(resolve, 80));

        const job = await service.getJobStatus(submission.jobId);
        assert.strictEqual(job?.status, 'completed');
        assert.strictEqual(job?.result.filename, 'stream_manual.txt');
    });
});
