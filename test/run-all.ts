import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import fs from 'node:fs';
import path from 'node:path';

function findTestFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'bun') continue; // Dedicated Bun compatibility suite (run via npm run test:bun)
            results.push(...findTestFiles(fullPath));
        } else if (entry.name.endsWith('.test.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

const testDir = path.resolve(process.cwd(), 'test');
const files = findTestFiles(testDir).sort();

if (files.length === 0) {
    console.error('No test files found in:', testDir);
    process.exit(1);
}

const isStrictZeroSkip = process.env.STRICT_ZERO_SKIP === 'true' || process.env.STRICT_ZERO_SKIP === '1' || process.argv.includes('--strict-zero-skip');

let passedCount = 0;
let failedCount = 0;
let skippedCount = 0;
const skippedTests: Array<{ name: string; file?: string; reason?: string }> = [];

const testStream = run({
    files,
    concurrency: 1
});

testStream.on('test:pass', (t: { name: string; file?: string; skip?: string | boolean }) => {
    if (t.skip !== undefined) {
        skippedCount++;
        skippedTests.push({
            name: t.name,
            file: t.file,
            reason: typeof t.skip === 'string' ? t.skip : 'unspecified'
        });
    } else {
        passedCount++;
    }
});

testStream.on('test:fail', () => {
    failedCount++;
    process.exitCode = 1;
});

testStream.on('test:summary', (data: { counts?: { tests: number; failed: number; passed: number; skipped: number } }) => {
    const summary = {
        timestamp: new Date().toISOString(),
        strictZeroSkip: isStrictZeroSkip,
        total: data.counts?.tests ?? (passedCount + failedCount + skippedCount),
        passed: data.counts?.passed ?? passedCount,
        failed: data.counts?.failed ?? failedCount,
        skipped: data.counts?.skipped ?? skippedCount,
        skippedTests,
        verdict: ((data.counts?.failed ?? failedCount) === 0 && (!isStrictZeroSkip || (data.counts?.skipped ?? skippedCount) === 0)) ? 'PASSED' : 'FAILED'
    };

    try {
        fs.writeFileSync('test-summary.json', JSON.stringify(summary, null, 2));
    } catch {}

    if (isStrictZeroSkip && (data.counts?.skipped ?? skippedCount) > 0) {
        process.stderr.write(`\n❌ [FAIL-CLOSED POLICY VIOLATION] STRICT_ZERO_SKIP is active but ${(data.counts?.skipped ?? skippedCount)} test(s) were skipped:\n`);
        for (const s of skippedTests) {
            process.stderr.write(`   - ${s.name} (${s.file ?? 'unknown file'}): ${s.reason ?? 'unspecified'}\n`);
        }
        process.exitCode = 1;
    }
});

testStream
    .compose(new spec())
    .pipe(process.stdout);
