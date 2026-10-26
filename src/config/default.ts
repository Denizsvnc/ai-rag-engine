export const ENGINE_DEFAULTS = {
    // SML (Semantic Model Layer) settings
    SML: {
        DEFAULT_MODEL: 'Xenova/all-MiniLM-L6-v2', // Lightweight and fast ONNX model
        MATCH_THRESHOLD: 0.65,                    // Minimum similarity threshold for tool/FAQ matches
    },

    // RAG / Vector search settings
    VECTOR_SEARCH: {
        TOP_K: 3, // Maximum number of context documents retrieved for the LLM
    },

    // Dynamic cache settings
    CACHE: {
        MIN_HITS_TO_PERSIST: 3,         // Queries asked at least 3 times are written to disk
        MAX_ITEMS_IN_RAM: 1000,         // Maximum items to keep in memory cache
        TTL_MS: 1000 * 60 * 60 * 24,    // Default cache TTL: 24 hours
    },

    // Storage paths
    PATHS: {
        CACHE_FILE: './data/query-cache.json',
        TOOLS_REGISTRY: './data/tools-registry.json',
    }
};