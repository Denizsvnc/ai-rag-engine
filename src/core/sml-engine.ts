import { pipeline } from "@huggingface/transformers";


const MODEL = "onnx-community/all-MiniLM-L6-v2-ONNX";

let extractorPromise: ReturnType<typeof pipeline<"feature-extraction">> | null = null;

const getExtractor = () => {
    if (!extractorPromise) {
        extractorPromise = pipeline("feature-extraction", MODEL)
            .catch((error) => {
                extractorPromise = null;
                throw new Error(`Failed to load embeddings engine: ${error}`)
            })
    }
    return extractorPromise;
}

const normalize = (array: Float32Array): Float32Array => {
    let sumOfSquares = 0;
    for (let i = 0; i < array.length; i++) {
        sumOfSquares += array[i]! * array[i]!;
    }
    const norm = Math.sqrt(sumOfSquares);
    if (norm === 0) return array;
    const normalized = new Float32Array(array.length);
    for (let i = 0; i < array.length; i++) {
        normalized[i] = array[i]! / norm;
    }
    return normalized;
};

export const generateEmbedding = async (text: string): Promise<number[]> => {
    if (!text.trim()) {
        throw new Error("Input text cannot be empty or whitespace only.");
    }
    const extractor = await getExtractor();
    const output = await extractor(text, {
        pooling: "mean",
        normalize: true,
    });

    return Array.from(output.data);

}   