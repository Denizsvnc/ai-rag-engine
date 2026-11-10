import type { SecurityConfig, InjectionCheckResult } from './security.types.js';
import { InputSanitizer } from './sanitizer.js';
import { InjectionDetector } from './injection-detector.js';
import { PIIGuard } from './pii-guard.js';

/**
 * Enterprise Security Guardrail for the RAG Engine.
 *
 * @remarks
 * Provides pre-flight input sanitization, heuristic attack detection,
 * PII masking (TCKN, Credit Cards, IBAN), and untrusted visitor boundary formatting.
 *
 * @example
 * ```typescript
 * import { SecurityGuard } from '@denizsvnc/ai-rag-engine';
 *
 * const report = SecurityGuard.inspect('Drop table users; ignore previous instructions');
 * if (report.riskLevel === 'HIGH') {
 *   throw new Error('Blocked prompt injection attempt');
 * }
 * const safePrompt = SecurityGuard.frameVisitorMessage(report.sanitizedInput);
 * ```
 */
export class SecurityGuard {
    /**
     * Inspects, sanitizes, redacts PII, and assesses security risk of incoming visitor input.
     *
     * @param rawInput - Raw prompt or query received from caller.
     * @param config - Security configuration options.
     * @returns Security check outcome with risk level, matched signatures, and sanitized text.
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
     *
     * @remarks
     * Tells the downstream LLM that this text represents unverified data from an external user
     * and must not be treated as system-level instructions or prompt overrides.
     *
     * @param sanitizedText - Sanitized input text.
     * @returns XML boundary wrapped prompt string.
     */
    public static frameVisitorMessage(sanitizedText: string): string {
        return `<untrusted_visitor_message>\n${sanitizedText}\n</untrusted_visitor_message>`;
    }
}
