import type { RiskLevel } from './security.types';

export interface DetectionResult {
    isRisk: boolean;
    riskLevel: RiskLevel;
    matchedPatterns: string[];
}

/**
 * Scans user inputs for heuristic patterns and known signatures of prompt injection,
 * jailbreaks, role hijacking, and prompt extraction attempts.
 */
export class InjectionDetector {
    /**
     * High-confidence, critical injection patterns (bilingual: Turkish & English).
     * Any match here immediately triggers HIGH risk classification.
     */
    private static readonly HIGH_RISK_PATTERNS: Array<{ id: string; regex: RegExp }> = [
        // 1. Direct instruction overrides & memory wipes
        {
            id: 'OVERRIDE_INSTRUCTIONS_EN',
            regex: /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|former|initial)\s+(instructions|prompts|rules|commands|constraints|directives|directions)\b/i
        },
        {
            id: 'OVERRIDE_INSTRUCTIONS_TR',
            regex: /\bönceki\s+(tüm\s+)?(talimatları|kuralları|komutları|yönergeleri|istekleri)\s+(unut|yoksay|sil|iptal\s+et)\b/i
        },
        {
            id: 'DISREGARD_RULES_TR',
            regex: /\btüm\s+kuralları\s+(yoksay|unut|boşver|bırak|çiğne)\b/i
        },

        // 2. Jailbreaks, DAN modes, role hijacking
        {
            id: 'JAILBREAK_MODE_EN',
            regex: /\b(you\s+are\s+now|act\s+as|switch\s+to|enter)\s+(an?\s+)?(developer|dan|jailbreak|unrestricted|unfiltered|god)\s*(mode|persona|ai)?\b/i
        },
        {
            id: 'JAILBREAK_MODE_TR',
            regex: /\bartık\s+(geliştirici|dan|kısıtlamasız|admin|jailbreak)\s+(modundasın|moduna\s+geç|olarak\s+davran)\b/i
        },
        {
            id: 'DISABLE_SAFETY_EN',
            regex: /\b(bypass|disable|remove|turn\s+off)\s+(all\s+)?(your\s+)?(filters|safety|guardrails|guidelines|restrictions)\b/i
        },
        {
            id: 'DISABLE_SAFETY_TR',
            regex: /\b(filtrelerini|güvenlik\s+kurallarını|kısıtlamalarını)\s+(kaldır|devre\s+dışı\s+bırak|kapat|yoksay)\b/i
        },

        // 3. Prompt leaking & system extraction
        {
            id: 'EXTRACT_PROMPT_EN',
            regex: /\b(repeat|show|print|reveal|output|display|dump|tell\s+me)\s+(all\s+)?(your\s+)?(exact\s+)?(system\s+prompt|initial\s+prompt|hidden\s+prompt|secret\s+instructions|system\s+instructions|base\s+instructions|internal\s+instructions)\b/i
        },
        {
            id: 'EXTRACT_PROMPT_TR',
            regex: /\b(sistem\s+promptu\w*|başlangıç\s+promptu\w*|gizli\s+talimat\w*|sana\s+verilen\s+talimat\w*|kurallarını)\b.*?(göster\w*|yaz\w*|yazdır\w*|tekrar\w*|açıkla\w*|paylaş\w*|listele\w*|söyle\w*|ver\w*)/i
        },
        {
            id: 'WHAT_IS_PROMPT_EN',
            regex: /\bwhat\s+(is|are)\s+your\s+(exact\s+)?(system\s+prompt|initial\s+instructions|hidden\s+rules|developer\s+instructions)\b/i
        },

        // 4. LLM Chat Template Delimiter Tokens
        {
            id: 'CHAT_TEMPLATE_DELIMITER_INJECTION',
            regex: /(<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|\[INST\]|\[\/INST\]|<<SYS>>|<\/s>)/i
        }
    ];

    /**
     * Medium-confidence suspicious patterns.
     */
    private static readonly MEDIUM_RISK_PATTERNS: Array<{ id: string; regex: RegExp }> = [
        {
            id: 'SUSPICIOUS_ROLEPLAY_EN',
            regex: /\bpretend\s+(you\s+have\s+no\s+rules|there\s+are\s+no\s+ethics|you\s+are\s+not\s+an\s+ai)\b/i
        },
        {
            id: 'SUSPICIOUS_ROLEPLAY_TR',
            regex: /\bhiçbir\s+kuralın\s+yokmuş\s+gibi\s+davran\b/i
        },
        {
            id: 'REVEAL_SECRET_KEYS',
            regex: /\b(api\s*keys?|secret\s*tokens?|database\s*passwords?|gizli\s*anahtar)\b/i
        }
    ];

    /**
     * Analyzes input text and classifies prompt injection risk.
     */
    public static detect(input: string, customPatterns?: RegExp[]): DetectionResult {
        const matched: string[] = [];

        // Check custom user patterns if provided
        if (customPatterns && customPatterns.length > 0) {
            for (let i = 0; i < customPatterns.length; i++) {
                const pat = customPatterns[i]!;
                if (pat.test(input)) {
                    matched.push(`CUSTOM_PATTERN_${i + 1}`);
                }
            }
        }

        // Check high-risk patterns
        for (const item of this.HIGH_RISK_PATTERNS) {
            if (item.regex.test(input)) {
                matched.push(item.id);
            }
        }

        if (matched.length > 0) {
            return {
                isRisk: true,
                riskLevel: 'HIGH',
                matchedPatterns: matched
            };
        }

        // Check medium-risk patterns
        for (const item of this.MEDIUM_RISK_PATTERNS) {
            if (item.regex.test(input)) {
                matched.push(item.id);
            }
        }

        if (matched.length > 0) {
            return {
                isRisk: true,
                riskLevel: 'MEDIUM',
                matchedPatterns: matched
            };
        }

        return {
            isRisk: false,
            riskLevel: 'NONE',
            matchedPatterns: []
        };
    }
}
