export interface PIIPolicy {
    enabled?: boolean;
    maskTCKN?: boolean;
    maskCreditCards?: boolean;
    maskIBAN?: boolean;
    maskEmails?: boolean;
    maskPhones?: boolean;
    allowUnmaskedForLocalLLM?: boolean;
    providerType?: 'cloud' | 'local' | 'custom';
}

export interface PIISanitizationResult {
    sanitizedText: string;
    hasPII: boolean;
    detectedEntities: Array<{
        type: 'TCKN' | 'CREDIT_CARD' | 'IBAN' | 'EMAIL' | 'PHONE';
        originalValue: string;
        maskedValue: string;
    }>;
    bypassedForLocalLLM: boolean;
}

export class PIIGuard {
    /**
     * Validates Turkish Republic Identity Number (TCKN) using official 11-digit checksum rules:
     * 1. 11 digits, cannot start with 0.
     * 2. 10th digit = ((d1+d3+d5+d7+d9)*7 - (d2+d4+d6+d8)) mod 10
     * 3. 11th digit = (d1+d2+...+d10) mod 10
     */
    public static isValidTCKN(candidate: string): boolean {
        if (!/^[1-9]\d{10}$/.test(candidate)) {
            return false;
        }

        const digits = candidate.split('').map(Number);
        const d = digits;

        const oddSum = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
        const evenSum = d[1]! + d[3]! + d[5]! + d[7]!;

        const tenthDigit = (((oddSum * 7 - evenSum) % 10) + 10) % 10;
        if (d[9] !== tenthDigit) {
            return false;
        }

        const sumFirstTen = digits.slice(0, 10).reduce((acc, curr) => acc + curr, 0);
        const eleventhDigit = sumFirstTen % 10;
        if (d[10] !== eleventhDigit) {
            return false;
        }

        return true;
    }

    /**
     * Validates Credit Card number using the Luhn mod-10 algorithm.
     */
    public static isValidCreditCard(candidate: string): boolean {
        const clean = candidate.replace(/[\s-]/g, '');
        if (!/^\d{13,19}$/.test(clean)) {
            return false;
        }

        let sum = 0;
        let shouldDouble = false;

        for (let i = clean.length - 1; i >= 0; i--) {
            let digit = parseInt(clean.charAt(i), 10);

            if (shouldDouble) {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }

            sum += digit;
            shouldDouble = !shouldDouble;
        }

        return sum % 10 === 0;
    }

    /**
     * Sanitizes input text, detecting and masking all sensitive PII entities.
     * Respects data sovereignty policies: strictly masks for Cloud LLMs.
     */
    public static sanitize(text: string, policy?: PIIPolicy): PIISanitizationResult {
        if (!text || policy?.enabled === false) {
            return {
                sanitizedText: text || '',
                hasPII: false,
                detectedEntities: [],
                bypassedForLocalLLM: false
            };
        }

        const detectedEntities: PIISanitizationResult['detectedEntities'] = [];
        let workingText = text;

        const maskTCKN = policy?.maskTCKN !== false;
        const maskCards = policy?.maskCreditCards !== false;
        const maskIBAN = policy?.maskIBAN !== false;
        const maskEmails = policy?.maskEmails !== false;
        const maskPhones = policy?.maskPhones !== false;

        // 1. TCKN Detection (Algorithmic 11-digit verification)
        if (maskTCKN) {
            // Match standalone 11-digit numbers or prefixed identifiers
            const tcknRegex = /(?:\b|[^\d])([1-9]\d{10})(?:\b|[^\d])/g;
            let match: RegExpExecArray | null;
            const tcknCandidates = new Set<string>();

            while ((match = tcknRegex.exec(workingText)) !== null) {
                const candidate = match[1]!;
                if (this.isValidTCKN(candidate)) {
                    tcknCandidates.add(candidate);
                }
            }

            for (const tckn of tcknCandidates) {
                const masked = `[TCKN_${tckn.slice(0, 3)}*****${tckn.slice(9)}]`;
                detectedEntities.push({
                    type: 'TCKN',
                    originalValue: tckn,
                    maskedValue: masked
                });
                workingText = workingText.split(tckn).join(masked);
            }
        }

        // 2. Credit Card Detection (Luhn algorithm)
        if (maskCards) {
            // Matches 13 to 19 digits formatted as 4-4-4-4 or raw
            const ccRegex = /\b(?:\d{4}[ -]?){3}\d{1,4}\b|\b\d{13,19}\b/g;
            let match: RegExpExecArray | null;
            const cardCandidates = new Set<string>();

            while ((match = ccRegex.exec(workingText)) !== null) {
                const raw = match[0]!;
                if (this.isValidCreditCard(raw)) {
                    cardCandidates.add(raw);
                }
            }

            for (const card of cardCandidates) {
                const clean = card.replace(/[\s-]/g, '');
                const masked = `[CARD_****_****_****_${clean.slice(-4)}]`;
                detectedEntities.push({
                    type: 'CREDIT_CARD',
                    originalValue: card,
                    maskedValue: masked
                });
                workingText = workingText.split(card).join(masked);
            }
        }

        // 3. IBAN Detection (TR and International)
        if (maskIBAN) {
            const ibanRegex = /\bTR\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{2}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
            let match: RegExpExecArray | null;
            const ibans = new Set<string>();

            while ((match = ibanRegex.exec(workingText)) !== null) {
                ibans.add(match[0]!);
            }

            for (const iban of ibans) {
                const clean = iban.replace(/\s/g, '');
                const masked = `[IBAN_${clean.slice(0, 4)}...${clean.slice(-4)}]`;
                detectedEntities.push({
                    type: 'IBAN',
                    originalValue: iban,
                    maskedValue: masked
                });
                workingText = workingText.split(iban).join(masked);
            }
        }

        // 4. Email Detection
        if (maskEmails) {
            const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g;
            let match: RegExpExecArray | null;
            const emails = new Set<string>();

            while ((match = emailRegex.exec(workingText)) !== null) {
                emails.add(match[0]!);
            }

            for (const email of emails) {
                const [user, domain] = email.split('@');
                const masked = `[EMAIL_${user!.slice(0, 2)}***@${domain}]`;
                detectedEntities.push({
                    type: 'EMAIL',
                    originalValue: email,
                    maskedValue: masked
                });
                workingText = workingText.split(email).join(masked);
            }
        }

        // 5. Phone Number Detection
        if (maskPhones) {
            const phoneRegex = /(?:\+?90\s?|0)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
            let match: RegExpExecArray | null;
            const phones = new Set<string>();

            while ((match = phoneRegex.exec(workingText)) !== null) {
                phones.add(match[0]!);
            }

            for (const phone of phones) {
                const clean = phone.replace(/[\s.-]/g, '');
                const masked = `[PHONE_***${clean.slice(-4)}]`;
                detectedEntities.push({
                    type: 'PHONE',
                    originalValue: phone,
                    maskedValue: masked
                });
                workingText = workingText.split(phone).join(masked);
            }
        }

        const hasPII = detectedEntities.length > 0;

        // Data Sovereignty & Local LLM Policy Check:
        // If provider is local/private VPC and policy explicitly allows unmasked local processing:
        const isLocalProvider = policy?.providerType === 'local' || policy?.providerType === 'custom';
        const bypassedForLocalLLM = Boolean(hasPII && isLocalProvider && policy?.allowUnmaskedForLocalLLM);

        return {
            sanitizedText: bypassedForLocalLLM ? text : workingText,
            hasPII,
            detectedEntities,
            bypassedForLocalLLM
        };
    }
}
