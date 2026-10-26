/**
 * Cleanses and neutralizes raw untrusted visitor input.
 */
export class InputSanitizer {
    /**
     * Regex matching zero-width invisible characters, byte-order marks, and unsafe control chars.
     * Frequently leveraged by attackers to hide prompt injection payloads from simple filters.
     */
    private static readonly INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

    /**
     * Tags and delimiters commonly used in prompt sandboxing and LLM chat templates.
     */
    private static readonly DELIMITER_ESCAPE_REGEX = /<\/?(?:untrusted_visitor_message|system|instruction|prompt|im_start|im_end|document|tool_result)[^>]*>/gi;

    /**
     * Sanitizes raw visitor input by stripping invisible chars, neutralizing delimiter breakout tags,
     * and bounding input length.
     */
    public static sanitize(rawInput: string, maxLength: number = 4000): string {
        if (!rawInput) return '';

        // 1. Strip invisible zero-width unicode characters
        let cleaned = rawInput.replace(this.INVISIBLE_CHARS_REGEX, '');

        // 2. Bound maximum input length to prevent token-flooding denial of service
        if (cleaned.length > maxLength) {
            cleaned = cleaned.slice(0, maxLength);
        }

        // 3. Neutralize any attempts by the visitor to inject closing/opening sandbox XML tags
        cleaned = cleaned.replace(this.DELIMITER_ESCAPE_REGEX, (match) => {
            return `[escaped_tag: ${match.replace(/[<>]/g, '')}]`;
        });

        // 4. Normalize excessive consecutive whitespace and carriage returns
        cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();

        return cleaned;
    }
}
