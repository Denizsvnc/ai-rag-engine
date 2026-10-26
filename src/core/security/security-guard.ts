import type { SecurityConfig, InjectionCheckResult } from './security.types';
import { InputSanitizer } from './sanitizer';
import { InjectionDetector } from './injection-detector';
import { PIIGuard } from './pii-guard';

/**
 * Enterprise Security Guardrail for the RAG Engine.
 * Provides pre-flight input sanitization, heuristic attack detection,
 * PII masking (TCKN, Credit Cards, IBAN), and untrusted visitor boundary formatting.
 */
export class SecurityGuard {
    /**
     * Inspects, sanitizes, redacts PII, and assesses security risk of incoming visitor input.
     */
    public static inspect(rawInput: string, config?: SecurityConfig): InjectionCheckResult {
        const maxLength = config?.maxInputLength ?? 4000;
        let sanitized = InputSanitizer.sanitize(rawInput, maxLength);

        if (config?.pii?.enabled !== false) {
            const piiResult = PIIGuard.sanitize(sanitized, config?.pii);
            sanitized = piiResult.sanitizedText;
        }

        const customPatterns = config?.customInjectionPatterns;
        const detection = InjectionDetector.detect(sanitized, customPatterns);

        return {
            isRisk: detection.isRisk,
            riskLevel: detection.riskLevel,
            matchedPatterns: detection.matchedPatterns,
            sanitizedInput: sanitized
        };
    }

    /**
     * Wraps visitor text into an explicit untrusted XML sandbox tag.
     * Tells the LLM that this text represents unverified data from a website visitor
     * and MUST NOT be treated as system-level instructions or behavioral overrides.
     */
    public static frameVisitorMessage(sanitizedText: string): string {
        return `<untrusted_visitor_message>\n${sanitizedText}\n</untrusted_visitor_message>`;
    }
}
