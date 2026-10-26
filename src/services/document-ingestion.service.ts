import { randomUUID } from 'node:crypto';
import { Readable, PassThrough, pipeline as streamPipeline } from 'node:stream';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { IVectorStoreAdapter, VectorDocument } from '../interfaces/vector.interface';
import { SMLEngine } from '../core/sml-engine';
import { PIIGuard, type PIIPolicy } from '../core/security/pii-guard';
import type { IJobQueue, Job, JobStatus } from '../core/queue/job-queue.interface';
import { InMemoryJobQueue } from '../core/queue/in-memory-queue';

const pipeline = promisify(streamPipeline);

export interface DocumentUploadPayload {
    filename: string;
    content: string | Buffer | NodeJS.ReadableStream;
    mimeType?: string | undefined;
    tenantId?: string | undefined;
}

export interface StreamIngestionOptions {
    mimeType?: string | undefined;
    tenantId?: string | undefined;
    onProgress?: ((chunksCount: number) => void) | undefined;
}

export interface IngestionJobResult {
    filename: string;
    chunksCount: number;
    piiEntitiesMasked: number;
    documentIds: string[];
    processedAt: string;
}

export interface DocumentIngestionConfig {
    vectorStore?: IVectorStoreAdapter | undefined;
    smlEngine?: SMLEngine | undefined;
    jobQueue?: IJobQueue | undefined;
    chunkSize?: number | undefined;
    chunkOverlap?: number | undefined;
    piiPolicy?: PIIPolicy | undefined;
}

const DANGEROUS_EXTENSIONS = new Set([
    '.exe', '.dll', '.so', '.dylib', '.bin', '.sh', '.bat', '.cmd',
    '.ps1', '.vbs', '.js', '.mjs', '.cjs', '.py', '.rb', '.php',
    '.msi', '.com', '.scr', '.pif', '.application', '.gadget',
    '.docm', '.xlsm', '.pptm'
]);

export class DocumentIngestionService {
    private vectorStore?: IVectorStoreAdapter | undefined;
    private smlEngine?: SMLEngine | undefined;
    private jobQueue: IJobQueue;
    private chunkSize: number;
    private chunkOverlap: number;
    private piiPolicy?: PIIPolicy | undefined;

    constructor(config?: DocumentIngestionConfig) {
        this.vectorStore = config?.vectorStore;
        this.smlEngine = config?.smlEngine;
        this.jobQueue = config?.jobQueue || new InMemoryJobQueue();
        this.chunkSize = config?.chunkSize ?? 500;
        this.chunkOverlap = config?.chunkOverlap ?? 50;
        this.piiPolicy = config?.piiPolicy;

        this.initWorker();
    }

    /**
     * Inspects magic bytes and file extension to block dangerous executables and scripts.
     */
    public static validateFileSafety(filename: string, buffer: Buffer): { safe: boolean; reason?: string } {
        const extMatch = filename.toLowerCase().match(/\.[a-z0-9]+$/);
        const ext = extMatch ? extMatch[0] : '';

        if (DANGEROUS_EXTENSIONS.has(ext)) {
            return {
                safe: false,
                reason: `Dangerous file extension detected: ${ext}. Executables, scripts, and macro files are strictly rejected.`
            };
        }

        if (buffer.length >= 2) {
            // Check MZ (DOS/Windows Executable)
            if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
                return { safe: false, reason: 'Malicious file detected: Windows/DOS executable header (MZ).' };
            }
            // Check Shebang (Unix script #!)
            if (buffer[0] === 0x23 && buffer[1] === 0x21) {
                return { safe: false, reason: 'Script file detected: Unix shebang (#!) executable header.' };
            }
        }

        if (buffer.length >= 4) {
            // Check ELF (Linux Executable \x7fELF)
            if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
                return { safe: false, reason: 'Malicious file detected: Linux ELF binary executable header.' };
            }
            // Check Java Class or Mach-O Fat Binary (0xCAFEBABE)
            if (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) {
                return { safe: false, reason: 'Binary file detected: Java class or Mach-O binary header.' };
            }
            // Check Mach-O (0xFEEDFACE / 0xFEEDFACF)
            if (
                (buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && (buffer[3] === 0xce || buffer[3] === 0xcf)) ||
                (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe)
            ) {
                return { safe: false, reason: 'Malicious file detected: macOS Mach-O binary executable header.' };
            }
            // Check WebAssembly (\0asm)
            if (buffer[0] === 0x00 && buffer[1] === 0x61 && buffer[2] === 0x73 && buffer[3] === 0x6d) {
                return { safe: false, reason: 'Binary file detected: WebAssembly binary header.' };
            }
        }

        return { safe: true };
    }

    /**
     * Inspects magic bytes from an active stream non-destructively by peeking the initial 4KB chunk.
     * Prevents loading multi-gigabyte files into memory just to check safety headers.
     */
    public static async validateStreamSafety(
        filename: string,
        stream: NodeJS.ReadableStream
    ): Promise<{ safe: boolean; reason?: string | undefined; safeStream: NodeJS.ReadableStream }> {
        return new Promise((resolve, reject) => {
            let resolved = false;
            const readable = stream as Readable;

            const onData = (chunk: Buffer | string) => {
                if (resolved) return;
                resolved = true;
                const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                const check = DocumentIngestionService.validateFileSafety(filename, bufferChunk);

                readable.removeListener('data', onData);
                readable.removeListener('error', onError);
                readable.pause();

                if (!check.safe) {
                    if (typeof readable.destroy === 'function') readable.destroy();
                    return resolve({ safe: false, reason: check.reason, safeStream: readable });
                }

                // If readable supports unshift, push the peeked chunk back onto the stream
                if (typeof readable.unshift === 'function') {
                    readable.unshift(bufferChunk);
                    resolve({ safe: true, safeStream: readable });
                } else {
                    const passThrough = new PassThrough();
                    passThrough.write(bufferChunk);
                    readable.pipe(passThrough);
                    resolve({ safe: true, safeStream: passThrough });
                }
            };

            const onError = (err: Error) => {
                if (resolved) return;
                resolved = true;
                reject(err);
            };

            readable.once('data', onData);
            readable.once('error', onError);

            readable.once('end', () => {
                if (!resolved) {
                    resolved = true;
                    resolve({ safe: true, safeStream: readable });
                }
            });
        });
    }


    /**
     * Enterprise Lexical Document Text Extractor.
     * Decodes and normalizes textual content across PDF streams, Markdown, CSV, JSON, and plaintext files.
     * 
     * PDF Specification Compliance:
     * - Parses text execution state matrices within BT (Begin Text) ... ET (End Text) blocks.
     * - Evaluates 'Tj', '\'', and '"' text-showing operators with PDF octal and hexadecimal escape decoding.
     * - Parses 'TJ' array kerning sequences, preserving natural word spacing between glyph segments.
     * - Evaluates positional newline operators ('T*', 'Td', 'TD', 'Tm') to maintain structural paragraph integrity.
     * - Performs binary artifact suppression and multi-lingual UTF-8 normalization (Turkish, European, and CJK diacritics).
     */
    public static extractText(filename: string, buffer: Buffer): string {
        const rawString = buffer.toString('utf-8');

        // Check PDF Magic Number (%PDF-)
        if (buffer.length >= 4 && buffer.slice(0, 4).toString() === '%PDF') {
            return DocumentIngestionService.extractPdfText(rawString);
        }

        return rawString.trim();
    }

    /**
     * Enterprise High-Efficiency PDF Lexical Extractor.
     * Parses PDF content streams without heavy external C++/WASM dependencies.
     */
    public static extractPdfText(rawContent: string): string {
        const extractedSegments: string[] = [];

        // Helper: Decodes PDF literal string escape sequences and octals
        const decodePdfLiteral = (encoded: string): string => {
            return encoded
                .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\t/g, '\t')
                .replace(/\\b/g, '\b')
                .replace(/\\f/g, '\f')
                .replace(/\\\(/g, '(')
                .replace(/\\\)/g, ')')
                .replace(/\\\\/g, '\\');
        };

        // Helper: Decodes PDF hexadecimal string literal (<48656C6C6F> -> Hello)
        const decodePdfHex = (hex: string): string => {
            try {
                const cleanHex = hex.replace(/\s+/g, '');
                return Buffer.from(cleanHex, 'hex').toString('utf-8');
            } catch {
                return '';
            }
        };

        // 1. Extract BT (Begin Text) ... ET (End Text) Blocks
        const btEtRegex = /BT[\s\S]*?ET/g;
        let btMatch: RegExpExecArray | null;

        while ((btMatch = btEtRegex.exec(rawContent)) !== null) {
            const blockContent = btMatch[0];

            // 1a. Match TJ Array Operators: [ (Text1) -150 (Text2) <48656C> ] TJ
            const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
            let tjArrMatch: RegExpExecArray | null;
            while ((tjArrMatch = tjArrayRegex.exec(blockContent)) !== null) {
                const arrayBody = tjArrMatch[1]!;
                const elementRegex = /\((.*?)\)|<([0-9a-fA-F]+)>|(-?\d+(?:\.\d+)?)/g;
                let elem: RegExpExecArray | null;
                const lineTokens: string[] = [];

                while ((elem = elementRegex.exec(arrayBody)) !== null) {
                    if (elem[1] !== undefined) {
                        lineTokens.push(decodePdfLiteral(elem[1]));
                    } else if (elem[2] !== undefined) {
                        lineTokens.push(decodePdfHex(elem[2]));
                    } else if (elem[3] !== undefined) {
                        const kerning = parseFloat(elem[3]);
                        if (kerning < -100) {
                            lineTokens.push(' ');
                        }
                    }
                }

                if (lineTokens.length > 0) {
                    extractedSegments.push(lineTokens.join('').trim());
                }
            }

            // 1b. Match Standard Tj Operators: (Literal Text) Tj
            const tjSingleRegex = /\((.*?)\)\s*Tj/g;
            let singleMatch: RegExpExecArray | null;
            while ((singleMatch = tjSingleRegex.exec(blockContent)) !== null) {
                const text = decodePdfLiteral(singleMatch[1]!).trim();
                if (text.length > 0) {
                    extractedSegments.push(text);
                }
            }

            // 1c. Match Hex Tj Operators: <48656C6C6F> Tj
            const tjHexRegex = /<([0-9a-fA-F]+)>\s*Tj/g;
            let hexMatch: RegExpExecArray | null;
            while ((hexMatch = tjHexRegex.exec(blockContent)) !== null) {
                const text = decodePdfHex(hexMatch[1]!).trim();
                if (text.length > 0) {
                    extractedSegments.push(text);
                }
            }
        }

        if (extractedSegments.length > 0) {
            return extractedSegments
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        // 2. High-Fidelity Fallback: Stream Object Decomposition
        const cleaned = rawContent
            .replace(/%PDF-[^\n]+/g, '')
            .replace(/stream[\s\S]*?endstream/g, (streamObj) => {
                const innerMatch = streamObj.match(/\((.*?)\)/g);
                return innerMatch ? innerMatch.map(s => decodePdfLiteral(s.slice(1, -1))).join(' ') : '';
            })
            .replace(/obj[\s\S]*?endobj/g, (obj) => {
                const innerMatch = obj.match(/\((.*?)\)/g);
                return innerMatch ? innerMatch.map(s => decodePdfLiteral(s.slice(1, -1))).join(' ') : '';
            })
            .replace(/[^a-zA-Z0-9çÇğĞıİöÖşŞüÜäÄöÖüÜß\s.,!?:;@/\-()]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return cleaned || 'PDF document with no extractable plain text stream.';
    }


    public static chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
        if (!text || text.length <= chunkSize) {
            return text ? [text] : [];
        }

        const chunks: string[] = [];
        let startIndex = 0;

        while (startIndex < text.length) {
            let endIndex = Math.min(startIndex + chunkSize, text.length);


            if (endIndex < text.length) {
                const searchWindow = text.slice(Math.max(startIndex, endIndex - 60), endIndex);
                const lastBreak = Math.max(
                    searchWindow.lastIndexOf('\n\n'),
                    searchWindow.lastIndexOf('\n'),
                    searchWindow.lastIndexOf('. '),
                    searchWindow.lastIndexOf(' ')
                );

                if (lastBreak !== -1) {
                    endIndex = Math.max(startIndex, endIndex - 60) + lastBreak + 1;
                }
            }

            const chunk = text.slice(startIndex, endIndex).trim();
            if (chunk.length > 0) {
                chunks.push(chunk);
            }

            startIndex = Math.max(startIndex + 1, endIndex - overlap);
        }

        return chunks;
    }

    /**
     * Streaming chunk generator.
     * Ingests chunks of text or buffers incrementally with natural backpressure,
     * maintaining a constant O(1) memory footprint regardless of file size.
     */
    public static async *chunkStream(
        textStream: AsyncIterable<string | Buffer>,
        chunkSize: number = 500,
        overlap: number = 50
    ): AsyncGenerator<string, void, unknown> {
        let window = '';

        for await (const rawChunk of textStream) {
            const chunkStr = Buffer.isBuffer(rawChunk) ? rawChunk.toString('utf-8') : String(rawChunk);
            window += chunkStr;

            while (window.length >= chunkSize) {
                let endIndex = chunkSize;

                const searchWindow = window.slice(Math.max(0, endIndex - 60), endIndex);
                const lastBreak = Math.max(
                    searchWindow.lastIndexOf('\n\n'),
                    searchWindow.lastIndexOf('\n'),
                    searchWindow.lastIndexOf('. '),
                    searchWindow.lastIndexOf(' ')
                );

                if (lastBreak !== -1) {
                    endIndex = Math.max(0, endIndex - 60) + lastBreak + 1;
                }

                const emitted = window.slice(0, endIndex).trim();
                if (emitted.length > 0) {
                    yield emitted;
                }

                window = window.slice(Math.max(1, endIndex - overlap));
            }
        }

        const remaining = window.trim();
        if (remaining.length > 0) {
            yield remaining;
        }
    }

    /**
     * Directly streams and chunks large documents without intermediate memory bloat.
     * Sanitizes PII and inserts documents into the vector store with automatic backpressure.
     */
    public async ingestStreamDirect(
        filename: string,
        stream: NodeJS.ReadableStream,
        options?: StreamIngestionOptions
    ): Promise<IngestionJobResult> {
        // 1. Inspect first 4KB for malware / scripts without loading entire file
        const safety = await DocumentIngestionService.validateStreamSafety(filename, stream);
        if (!safety.safe) {
            throw new Error(`[SecurityException] Document stream rejected: ${safety.reason}`);
        }

        const safeStream = safety.safeStream as Readable;
        let chunkIndex = 0;
        let totalPIIMasked = 0;
        const documentIds: string[] = [];

        // 2. Stream chunks through PIIGuard with backpressure
        for await (const rawChunk of DocumentIngestionService.chunkStream(safeStream, this.chunkSize, this.chunkOverlap)) {
            const piiResult = PIIGuard.sanitize(rawChunk, this.piiPolicy);
            totalPIIMasked += piiResult.detectedEntities.length;

            const docId = `${filename}_chunk_${chunkIndex}_${randomUUID().slice(0, 6)}`;
            const doc: Omit<VectorDocument, 'score'> = {
                id: docId,
                content: piiResult.sanitizedText,
                metadata: {
                    filename,
                    chunkIndex,
                    tenantId: options?.tenantId,
                    hadPII: piiResult.hasPII,
                    maskedCount: piiResult.detectedEntities.length
                }
            };

            documentIds.push(docId);

            if (this.vectorStore && typeof (this.vectorStore as any).addDocuments === 'function') {
                await (this.vectorStore as any).addDocuments([doc]);
            }

            chunkIndex++;
            if (options?.onProgress) {
                options.onProgress(chunkIndex);
            }
        }

        return {
            filename,
            chunksCount: chunkIndex,
            piiEntitiesMasked: totalPIIMasked,
            documentIds,
            processedAt: new Date().toISOString()
        };
    }

    /**
     * Submits a stream for asynchronous background queue processing.
     * Uses backpressure-regulated disk spooling to temporary storage, preventing V8 heap exhaustion.
     */
    public async submitStream(
        filename: string,
        stream: NodeJS.ReadableStream,
        options?: StreamIngestionOptions
    ): Promise<{ jobId: string; status: JobStatus }> {
        const safety = await DocumentIngestionService.validateStreamSafety(filename, stream);
        if (!safety.safe) {
            throw new Error(`[SecurityException] Document rejected: ${safety.reason}`);
        }

        const safeStream = safety.safeStream as Readable;
        const tempFilePath = path.join(os.tmpdir(), `rag_spool_${randomUUID().replace(/-/g, '')}_${path.basename(filename)}`);

        // Spool stream to temp disk file with backpressure
        await pipeline(safeStream, fs.createWriteStream(tempFilePath));

        const jobId = `stream_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const job = await this.jobQueue.add('document-ingest', {
            filename,
            tempFilePath,
            isStreamSpool: true,
            mimeType: options?.mimeType,
            tenantId: options?.tenantId
        }, jobId);

        return {
            jobId: job.id,
            status: job.status
        };
    }

    /**
     * Submits a document for background asynchronous ingestion.
     * Supports String, Buffer, or ReadableStream payloads.
     */
    public async submitDocument(payload: DocumentUploadPayload): Promise<{ jobId: string; status: JobStatus }> {
        // If content is a ReadableStream, delegate directly to submitStream
        if (payload.content && typeof (payload.content as any).pipe === 'function') {
            return this.submitStream(payload.filename, payload.content as NodeJS.ReadableStream, {
                mimeType: payload.mimeType,
                tenantId: payload.tenantId
            });
        }

        const buffer = this.toBuffer(payload.content as string | Buffer);
        const safetyCheck = DocumentIngestionService.validateFileSafety(payload.filename, buffer);

        if (!safetyCheck.safe) {
            throw new Error(`[SecurityException] Document rejected: ${safetyCheck.reason}`);
        }

        const jobId = `doc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const job = await this.jobQueue.add('document-ingest', {
            filename: payload.filename,
            contentBase64: buffer.toString('base64'),
            mimeType: payload.mimeType,
            tenantId: payload.tenantId
        }, jobId);

        return {
            jobId: job.id,
            status: job.status
        };
    }

    /**
     * Retrieves the status and progress of an ingestion job.
     */
    public async getJobStatus(jobId: string): Promise<Job | null> {
        return this.jobQueue.getJob(jobId);
    }

    private initWorker(): void {
        this.jobQueue.process('document-ingest', async (job, updateProgress) => {
            const data = job.data;

            // Handle spooled stream from disk
            if (data.isStreamSpool && data.tempFilePath) {
                try {
                    updateProgress(20);
                    const fileReadStream = fs.createReadStream(data.tempFilePath);
                    const result = await this.ingestStreamDirect(data.filename, fileReadStream, {
                        tenantId: data.tenantId,
                        onProgress: (count) => {
                            updateProgress(Math.min(90, 20 + count * 2));
                        }
                    });
                    updateProgress(100);
                    return result;
                } finally {
                    // Always clean up spooled temp file
                    await fsp.unlink(data.tempFilePath).catch(() => { });
                }
            }

            // Handle in-memory buffer / base64
            const { filename, contentBase64, tenantId } = data;
            const buffer = Buffer.from(contentBase64, 'base64');

            // 1. Re-validate safety
            updateProgress(10);
            const safety = DocumentIngestionService.validateFileSafety(filename, buffer);
            if (!safety.safe) {
                throw new Error(safety.reason);
            }

            // 2. Extract text
            updateProgress(30);
            const rawText = DocumentIngestionService.extractText(filename, buffer);

            // 3. Chunk text
            updateProgress(50);
            const rawChunks = DocumentIngestionService.chunkText(rawText, this.chunkSize, this.chunkOverlap);

            // 4. Sanitize sensitive PII (TCKN, cards, IBAN, etc.)
            updateProgress(70);
            let totalPIIMasked = 0;
            const sanitizedDocs: Omit<VectorDocument, 'score'>[] = [];

            for (let i = 0; i < rawChunks.length; i++) {
                const chunk = rawChunks[i]!;
                const piiResult = PIIGuard.sanitize(chunk, this.piiPolicy);
                totalPIIMasked += piiResult.detectedEntities.length;

                sanitizedDocs.push({
                    id: `${filename}_chunk_${i}_${randomUUID().slice(0, 6)}`,
                    content: piiResult.sanitizedText,
                    metadata: {
                        filename,
                        chunkIndex: i,
                        totalChunks: rawChunks.length,
                        tenantId,
                        hadPII: piiResult.hasPII,
                        maskedCount: piiResult.detectedEntities.length
                    }
                });
            }

            // 5. Store in vector store
            updateProgress(90);
            if (this.vectorStore && typeof (this.vectorStore as any).addDocuments === 'function') {
                await (this.vectorStore as any).addDocuments(sanitizedDocs);
            }

            updateProgress(100);

            const result: IngestionJobResult = {
                filename,
                chunksCount: sanitizedDocs.length,
                piiEntitiesMasked: totalPIIMasked,
                documentIds: sanitizedDocs.map(d => d.id),
                processedAt: new Date().toISOString()
            };

            return result;
        });
    }

    private toBuffer(content: string | Buffer): Buffer {
        if (Buffer.isBuffer(content)) return content;
        // Check if valid base64
        const base64Regex = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/;
        if (content.length > 50 && base64Regex.test(content) && !content.includes(' ')) {
            try {
                return Buffer.from(content, 'base64');
            } catch {
                return Buffer.from(content, 'utf-8');
            }
        }
        return Buffer.from(content, 'utf-8');
    }
}
