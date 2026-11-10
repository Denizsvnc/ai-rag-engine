/**
 * Generic caching interface implemented by in-memory LRU and distributed Redis adapters.
 *
 * @typeParam T - Type of the cached values. Defaults to `unknown`.
 */
export interface ICacheAdapter<T = unknown> {
    /**
     * Retrieves a cached value by key.
     *
     * @param key - Unique cache key.
     * @returns The cached item, or `null` if expired or not found.
     */
    get(key: string): Promise<T | null>;

    /**
     * Stores a key-value pair in cache with optional TTL.
     *
     * @param key - Unique cache key.
     * @param value - Value to store.
     * @param ttlMs - Time-to-live in milliseconds.
     */
    set(key: string, value: T, ttlMs?: number): Promise<void>;

    /**
     * Deletes a cached entry by key.
     *
     * @param key - Cache key to remove.
     * @returns `true` if an item was deleted, otherwise `false`.
     */
    delete(key: string): Promise<boolean>;

    /**
     * Invalidates cached items matching a key prefix or regular expression.
     *
     * @param patternOrKey - Exact key prefix or regular expression pattern.
     * @returns Number of evicted keys.
     */
    invalidate(patternOrKey: string | RegExp): Promise<number>;

    /**
     * Clears all entries from the cache.
     */
    clear(): Promise<void>;

    /**
     * Returns the current number of cached items if supported.
     */
    size?(): number;
}