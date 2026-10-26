import test from 'node:test';
import assert from 'node:assert/strict';
import { PIIGuard } from '../../src/core/security/pii-guard';

test('Security Guard - PIIGuard & Data Sovereignty', async (t) => {
    await t.test('should validate TCKN using algorithmic 10th and 11th digit modulo rules', () => {
        // Mathematically valid TCKNs:
        // 10000000146: oddSum=2, evenSum=0, d10=((14)-0)%10=4, sum10=6, d11=6
        assert.equal(PIIGuard.isValidTCKN('10000000146'), true);
        // 24680246800: oddSum=20, evenSum=20, d10=((140-20))%10=0, sum10=40, d11=0
        assert.equal(PIIGuard.isValidTCKN('24680246800'), true);

        // Invalid: Starts with 0
        assert.equal(PIIGuard.isValidTCKN('00000000146'), false);
        // Invalid: Checksum mismatch (changed 10th digit)
        assert.equal(PIIGuard.isValidTCKN('10000000156'), false);
        // Invalid: Checksum mismatch (changed 11th digit)
        assert.equal(PIIGuard.isValidTCKN('10000000147'), false);
        // Invalid: Random 11-digit number
        assert.equal(PIIGuard.isValidTCKN('12345678901'), false);
    });

    await t.test('should mask valid TCKN but preserve non-TCKN 11-digit order IDs', () => {
        const text = 'Siparişim 12345678901 ve müşteri T.C. kimlik numaram 10000000146 olarak kayıtlı.';
        const result = PIIGuard.sanitize(text);

        assert.equal(result.hasPII, true);
        assert.equal(result.detectedEntities.length, 1);
        assert.equal(result.detectedEntities[0]?.type, 'TCKN');
        assert.ok(!result.sanitizedText.includes('10000000146'), 'TCKN should be redacted');
        assert.ok(result.sanitizedText.includes('12345678901'), 'Benign 11-digit order ID should NOT be redacted');
    });

    await t.test('should validate and mask Credit Cards using Luhn algorithm', () => {
        // Valid Luhn card
        assert.equal(PIIGuard.isValidCreditCard('4532015012345671'), true);
        assert.equal(PIIGuard.isValidCreditCard('4532-0150-1234-5671'), true);

        // Invalid Luhn
        assert.equal(PIIGuard.isValidCreditCard('4532015012345679'), false);

        const prompt = 'Kart numaram: 4532-0150-1234-5671 ile çekim yapın.';
        const res = PIIGuard.sanitize(prompt);
        assert.equal(res.hasPII, true);
        assert.ok(!res.sanitizedText.includes('4532-0150-1234-5671'));
        assert.ok(res.sanitizedText.includes('[CARD_****_****_****_5671]'));
    });

    await t.test('should mask Turkish IBAN, email addresses, and phone numbers', () => {
        const sensitiveInfo = 'Bana TR330006100512345678901234 ibanından, ahmet.yilmaz@sirket.com.tr adresinden veya 05321234567 nolu telefondan ulaşın.';
        const result = PIIGuard.sanitize(sensitiveInfo);

        assert.equal(result.hasPII, true);
        assert.ok(!result.sanitizedText.includes('TR330006100512345678901234'));
        assert.ok(!result.sanitizedText.includes('ahmet.yilmaz@sirket.com.tr'));
        assert.ok(!result.sanitizedText.includes('05321234567'));
        assert.ok(result.sanitizedText.includes('[IBAN_'));
        assert.ok(result.sanitizedText.includes('[EMAIL_'));
        assert.ok(result.sanitizedText.includes('[PHONE_'));
    });

    await t.test('should enforce strict masking for Cloud LLMs (OpenAI, Gemini)', () => {
        const text = 'TCKN: 10000000146, Email: user@test.com';
        // Even if allowUnmaskedForLocalLLM is mistakenly set to true, providerType: 'cloud' must ALWAYS mask
        const result = PIIGuard.sanitize(text, {
            providerType: 'cloud',
            allowUnmaskedForLocalLLM: true
        });

        assert.equal(result.bypassedForLocalLLM, false);
        assert.ok(!result.sanitizedText.includes('10000000146'), 'Cloud LLM must NEVER receive raw TCKN');
    });

    await t.test('should allow unmasked transmission only when using local LLM and legally permitted', () => {
        const text = 'TCKN: 10000000146, Email: user@test.com';
        
        // 1. Local LLM but policy disabled -> masked
        const lockedLocal = PIIGuard.sanitize(text, {
            providerType: 'local',
            allowUnmaskedForLocalLLM: false
        });
        assert.equal(lockedLocal.bypassedForLocalLLM, false);
        assert.ok(!lockedLocal.sanitizedText.includes('10000000146'));

        // 2. Local LLM with legal permission -> unmasked for local VPC reasoning
        const permittedLocal = PIIGuard.sanitize(text, {
            providerType: 'local',
            allowUnmaskedForLocalLLM: true
        });
        assert.equal(permittedLocal.bypassedForLocalLLM, true);
        assert.equal(permittedLocal.sanitizedText, text);
        assert.equal(permittedLocal.hasPII, true);
    });
});
