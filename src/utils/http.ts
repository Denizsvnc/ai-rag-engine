/** Prevent provider calls from holding an HTTP request indefinitely. */
export function providerTimeoutSignal(): AbortSignal {
    const milliseconds = Number(process.env.LLM_TIMEOUT_MS ?? 60000);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 300000) throw new Error('LLM_TIMEOUT_MS must be between 1 and 300000.');
    return AbortSignal.timeout(milliseconds);
}
