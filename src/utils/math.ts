export function dotProduct(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        throw new Error("Vector dimensions do not match");
    }
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
        sum += (vecA[i] ?? 0) * (vecB[i] ?? 0);
    }
    return sum;
}

export function magnitude(vec: number[]): number {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) {
        const val = vec[i] ?? 0;
        sum += val * val;
    }
    return Math.sqrt(sum);
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) throw new Error("Vector dimensions do not match");
    const magA = magnitude(vecA);
    const magB = magnitude(vecB);
    if (magA === 0 || magB === 0) return 0;
    return dotProduct(vecA, vecB) / (magA * magB);
}