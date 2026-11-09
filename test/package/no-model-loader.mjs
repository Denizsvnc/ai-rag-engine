export async function resolve(specifier, context, nextResolve) {
    if (specifier === '@huggingface/transformers') throw new Error('Unexpected model runtime import in a deterministic consumer.');
    return nextResolve(specifier, context);
}
