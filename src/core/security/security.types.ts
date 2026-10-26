import type { PIIPolicy } from './pii-guard';

export type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface InjectionCheckResult {
    isRisk: boolean;
    riskLevel: RiskLevel;
    matchedPatterns: string[];
    sanitizedInput: string;
}

export interface SecurityConfig {
    /**
     * Whether prompt injection defense and input sanitization are enabled.
     * Defaults to true.
     */
    enabled?: boolean | undefined;

    /**
     * If true, queries detected as high-risk prompt injection attacks are blocked
     * immediately without invoking LLM or tool execution.
     * Defaults to true.
     */
    blockHighRiskInjections?: boolean | undefined;

    /**
     * Maximum character length allowed for user input to prevent token flooding DoS.
     * Defaults to 4000.
     */
    maxInputLength?: number | undefined;

    /**
     * Custom response returned to the visitor when an injection attempt is blocked.
     */
    customRefusalMessage?: string | undefined;

    /**
     * Additional regex patterns to classify as prompt injection attacks.
     */
    customInjectionPatterns?: RegExp[] | undefined;

    /**
     * Data Privacy & Sovereignty policy for masking sensitive PII (TCKN, Credit Cards, IBAN, etc.).
     */
    pii?: PIIPolicy | undefined;
}
