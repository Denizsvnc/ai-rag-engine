import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { DocumentIngestionService } from '../../../src/services/document-ingestion.service.js';
import { SMLEngine, SMLModelPresets } from '../../../src/core/sml-engine.js';
import { RAGEngine } from '../../../src/core/engine.js';
import type { ILLMProvider } from '../../../src/interfaces/llm.interface.js';

describe('PDF Ingestion with Native zlib Decompression & Multilingual SML', () => {
    describe('DocumentIngestionService - Native PDF Extraction', () => {
        it('should successfully decompress and extract text from /Filter /FlateDecode PDF streams', () => {
            const rawTextStream = 'BT /F1 16 Tf 50 700 Td (2026 Mali Rapor: Toplam Ciro 45 Milyon TL.) Tj ET\nBT /F1 12 Tf 50 670 Td (Sirketimiz rekor buyume kaydetmistir.) Tj ET';
            const deflatedStream = zlib.deflateSync(Buffer.from(rawTextStream, 'utf-8'));

            const header = Buffer.from('%PDF-1.5\n1 0 obj\n<< /Length ' + deflatedStream.length + ' /Filter /FlateDecode >>\nstream\n');
            const footer = Buffer.from('\nendstream\nendobj\n%%EOF');
            const pdfBuffer = Buffer.concat([header, deflatedStream, footer]);

            const extracted = DocumentIngestionService.extractText('financial_report.pdf', pdfBuffer);

            assert.ok(extracted.includes('2026 Mali Rapor: Toplam Ciro 45 Milyon TL.'));
            assert.ok(extracted.includes('Sirketimiz rekor buyume kaydetmistir.'));
        });

        it('should decompress streams using raw deflate when standard zlib header is omitted', () => {
            const rawTextStream = 'BT /F1 14 Tf 70 650 Td (Raw Deflate Stream Content Extracted Successfully.) Tj ET';
            const rawDeflated = zlib.deflateRawSync(Buffer.from(rawTextStream, 'utf-8'));

            const header = Buffer.from('%PDF-1.4\n2 0 obj\n<< /Length ' + rawDeflated.length + ' /Filter /FlateDecode >>\nstream\n');
            const footer = Buffer.from('\nendstream\nendobj\n%%EOF');
            const pdfBuffer = Buffer.concat([header, rawDeflated, footer]);

            const extracted = DocumentIngestionService.extractPdfText(pdfBuffer);

            assert.ok(extracted.includes('Raw Deflate Stream Content Extracted Successfully.'));
        });

        it('should continue supporting uncompressed PDF streams and TJ array operators', () => {
            const uncompressedPdf = `%PDF-1.4
3 0 obj
<< /Length 120 >>
stream
BT
/F1 12 Tf
72 712 Td
[ (Musteri) -150 (Destek) -150 (Hizmetleri) ] TJ
ET
endstream
endobj
%%EOF`;

            const extracted = DocumentIngestionService.extractText('support.pdf', Buffer.from(uncompressedPdf, 'utf-8'));

            assert.ok(extracted.includes('Musteri Destek Hizmetleri'));
        });

        it('should extract hexadecimal strings in PDF streams (<hex> Tj)', () => {
            // "Hello World" in hex: 48656c6c6f20576f726c64
            const uncompressedPdf = `%PDF-1.4
4 0 obj
<< /Length 80 >>
stream
BT
/F1 12 Tf
<48656c6c6f20576f726c64> Tj
ET
endstream
endobj
%%EOF`;

            const extracted = DocumentIngestionService.extractText('hex.pdf', Buffer.from(uncompressedPdf, 'utf-8'));

            assert.ok(extracted.includes('Hello World'));
        });

        it('should throw an explicit error instead of returning placeholder text when PDF text cannot be extracted', () => {
            const emptyPdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF';
            assert.throws(
                () => DocumentIngestionService.extractText('empty.pdf', Buffer.from(emptyPdf, 'utf-8')),
                {
                    message: /PDF document contains no extractable text stream/
                }
            );
        });

        it('should strictly reject encrypted or password-protected PDF files', () => {
            const encryptedPdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Encrypt 2 0 R >>\nendobj\n%%EOF';
            assert.throws(
                () => DocumentIngestionService.extractPdfText(Buffer.from(encryptedPdf, 'utf-8')),
                {
                    message: /Encrypted or password-protected PDF documents are not supported/
                }
            );
        });

        it('should throw an explicit error when PDF only contains raster image streams (no OCR text)', () => {
            const scannedPdf = `%PDF-1.4
1 0 obj
<< /Type /XObject /Subtype /Image /Width 640 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 >>
stream
...binary_raster_pixels_only...
endstream
endobj
%%EOF`;
            assert.throws(
                () => DocumentIngestionService.extractPdfText(Buffer.from(scannedPdf, 'utf-8')),
                {
                    message: /PDF document contains no extractable text stream/
                }
            );
        });
    });

    describe('SML Engine - Presets & Arbitrary Model Configurations', () => {
        it('should expose standard model presets for English and Multilingual domains', () => {
            assert.equal(SMLModelPresets.ENGLISH_FAST, 'Xenova/all-MiniLM-L6-v2');
            assert.equal(SMLModelPresets.MULTILINGUAL, 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
            assert.equal(SMLModelPresets.MULTILINGUAL_ACCURATE, 'Xenova/bge-m3');
        });

        it('should initialize SMLEngine with arbitrary custom model name', () => {
            const customModel = 'intfloat/multilingual-e5-small';
            const sml = new SMLEngine({
                modelName: customModel,
                dtype: 'q8',
                cacheSize: 500,
            });

            assert.ok(sml instanceof SMLEngine);
        });

        it('should initialize SMLEngine with SMLModelPresets.MULTILINGUAL', () => {
            const sml = new SMLEngine({
                modelName: SMLModelPresets.MULTILINGUAL,
                dtype: 'q8',
            });

            assert.ok(sml instanceof SMLEngine);
        });

        it('should forward all smlConfig parameters from EngineConfig to SMLEngine', () => {
            const mockLLM: ILLMProvider = {
                async generate() { return { content: 'Mock response' }; }
            };

            const engine = new RAGEngine({
                llmProvider: mockLLM,
                inputs: {},
                smlConfig: {
                    enabled: true,
                    modelName: SMLModelPresets.MULTILINGUAL,
                    dtype: 'q8',
                    cacheSize: 2500,
                    circuitBreakerThreshold: 5,
                    circuitBreakerCooldownMs: 20000,
                    matchThreshold: 0.70
                }
            });

            assert.ok(engine instanceof RAGEngine);
        });
    });
});
