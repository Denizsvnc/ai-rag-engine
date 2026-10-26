import { randomUUID } from 'node:crypto';
import type { IVectorStoreAdapter, VectorDocument } from '../interfaces/vector.interface';
import { SMLEngine } from '../core/sml-engine';
import { PIIGuard, type PIIPolicy } from '../core/security/pii-guard';
import type { IJobQueue, Job, JobStatus } from '../core/queue/job-queue.interface';
import { InMemoryJobQueue } from '../core/queue/in-memory-queue';

export interface DocumentUploadPayload {
    filename: string;
    content: string | Buffer; // utf-8 string, base64 string, or Buffer
    mimeType?: string;
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
     * Extracts text from document Buffer (supports PDF, TXT, MD, CSV, JSON).
     */
    public static extractText(filename: string, buffer: Buffer): string {
        const rawString = buffer.toString('utf-8');

        // Basic PDF text stream parser
        if (buffer.length >= 4 && buffer.slice(0, 4).toString() === '%PDF') {
            const textMatches: string[] = [];
            // Match text inside BT ... ET blocks and Tj / TJ operators
            const tjRegex = /\(([^)]+)\)\s*Tj/g;
            let match: RegExpExecArray | null;
            while ((match = tjRegex.exec(rawString)) !== null) {
                textMatches.push(match[1]!);
            }

            if (textMatches.length > 0) {
                return textMatches.join(' ');
            }

            // Fallback: extract printable strings from PDF stream
            const cleaned = rawString
                .replace(/%PDF-[^\n]+/g, '')
                .replace(/obj[\s\S]*?endobj/g, (obj) => {
                    const innerMatch = obj.match(/\((.*?)\)/g);
                    return innerMatch ? innerMatch.map(s => s.slice(1, -1)).join(' ') : '';
                })
                .replace(/[^a-zA-Z0-9çÇğĞıİöÖşŞüÜ\s.,!?:;@/-]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            return cleaned || 'PDF document with no extractable plain text stream.';
        }

        return rawString.trim();
    }

    /**
     * Splits text into overlapping chunks using natural linguistic boundaries.
     */
    public static chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
        if (!text || text.length <= chunkSize) {
            return text ? [text] : [];
        }

        const chunks: string[] = [];
        let startIndex = 0;

        while (startIndex < text.length) {
            let endIndex = Math.min(startIndex + chunkSize, text.length);

            // Attempt to break on paragraph or sentence boundary if not at end of text
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
     * Submits a document for background asynchronous ingestion.
     * Enforces pre-flight security checks before queuing.
     */
    public async submitDocument(payload: DocumentUploadPayload): Promise<{ jobId: string; status: JobStatus }> {
        const buffer = this.toBuffer(payload.content);
        const safetyCheck = DocumentIngestionService.validateFileSafety(payload.filename, buffer);

        if (!safetyCheck.safe) {
            throw new Error(`[SecurityException] Document rejected: ${safetyCheck.reason}`);
        }

        const jobId = `doc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const job = await this.jobQueue.add('document-ingest', {
            filename: payload.filename,
            contentBase64: buffer.toString('base64'),
            mimeType: payload.mimeType
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
            const { filename, contentBase64 } = job.data;
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
