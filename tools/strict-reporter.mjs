import fs from 'node:fs';

export default async function* strictReporter(source) {
    const isStrictZeroSkip = process.env.STRICT_ZERO_SKIP === 'true' || process.env.STRICT_ZERO_SKIP === '1';
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const skippedTests = [];

    for await (const event of source) {
        if (event.type === 'test:pass') {
            if (event.data && event.data.skip !== undefined) {
                totalSkipped++;
                skippedTests.push({
                    name: event.data.name,
                    file: event.data.file,
                    reason: typeof event.data.skip === 'string' ? event.data.skip : 'unspecified'
                });
            } else {
                totalPassed++;
            }
        } else if (event.type === 'test:fail') {
            totalFailed++;
        }
    }

    const summary = {
        timestamp: new Date().toISOString(),
        strictZeroSkip: isStrictZeroSkip,
        total: totalPassed + totalFailed + totalSkipped,
        passed: totalPassed,
        failed: totalFailed,
        skipped: totalSkipped,
        skippedTests,
        verdict: (totalFailed === 0 && (!isStrictZeroSkip || totalSkipped === 0)) ? 'PASSED' : 'FAILED'
    };

    try {
        fs.writeFileSync('test-summary.json', JSON.stringify(summary, null, 2));
    } catch {}

    if (isStrictZeroSkip && totalSkipped > 0) {
        process.stderr.write(`\n❌ [FAIL-CLOSED POLICY VIOLATION] STRICT_ZERO_SKIP is active but ${totalSkipped} test(s) were skipped:\n`);
        for (const s of skippedTests) {
            process.stderr.write(`   - ${s.name} (${s.file ?? 'unknown file'}): ${s.reason}\n`);
        }
        process.exitCode = 1;
    }

    yield JSON.stringify(summary, null, 2) + '\n';
}
