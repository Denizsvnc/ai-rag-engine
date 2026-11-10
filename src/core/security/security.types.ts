import type { PIIPolicy } from './pii-guard.js';

/**
 * Assessed risk severity level for detected prompt injection or security anomalies.
 */
export type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Result report generated after running injection vulnerability checks.
 */
export interface InjectionCheckResult {
    /** Whether prompt injection or malicious anomaly was detected. */
    isRisk: boolean;
    /** Classified risk level. */
    riskLevel: RiskLevel;
    /** Identifiers or substrings of matched attack signatures. */
    matchedPatterns: string[];
    /** Sanitized and neutral representation of the user input. */
    sanitizedInput: string;
}

/**
 * Global security guardrail and data privacy configuration options.
 */
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
