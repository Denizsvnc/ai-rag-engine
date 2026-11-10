import fs from 'node:fs';

const reportPath = process.argv[2] || 'test-summary.json';

if (!fs.existsSync(reportPath)) {
    console.error(`[FAIL-CLOSED] Verification failed: Test summary file not found at ${reportPath}`);
    process.exit(1);
}

try {
    const raw = fs.readFileSync(reportPath, 'utf8');
    const summary = JSON.parse(raw);

    console.log(`[Zero-Skip Verifier] Inspecting ${reportPath}:`);
    console.log(`  - Total Tests: ${summary.total}`);
    console.log(`  - Passed: ${summary.passed}`);
    console.log(`  - Failed: ${summary.failed}`);
    console.log(`  - Skipped: ${summary.skipped}`);
    console.log(`  - Verdict: ${summary.verdict}`);

    if (summary.failed > 0) {
        console.error(`[FAIL-CLOSED] Release blocked: ${summary.failed} test(s) failed.`);
        process.exit(1);
    }

    if (summary.skipped > 0) {
        console.error(`[FAIL-CLOSED] Release blocked: Strict zero-skip policy violated with ${summary.skipped} skipped test(s).`);
        if (Array.isArray(summary.skippedTests)) {
            for (const s of summary.skippedTests) {
                console.error(`    * ${s.name} (${s.file ?? 'unknown'}): ${s.reason ?? 'unspecified'}`);
            }
        }
        process.exit(1);
    }

    if (summary.verdict !== 'PASSED') {
        console.error(`[FAIL-CLOSED] Release blocked: Verdict is '${summary.verdict}', expected 'PASSED'.`);
        process.exit(1);
    }

    console.log(`✅ [Zero-Skip Verifier] All tests passed with zero skipped tests. Release gate clear.`);
    process.exit(0);
} catch (err) {
    console.error(`[FAIL-CLOSED] Error parsing test summary report:`, err);
    process.exit(1);
}

