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

const testStream = run({
    files,
    concurrency: 1
});

testStream
    .on('test:fail', () => {
        process.exitCode = 1;
    })
    .compose(new spec())
    .pipe(process.stdout);
