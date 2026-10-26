export interface ICacheAdapter {
    get(key: string): Promise<any | null>;
    set(key: string, value: any, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<boolean>;
    invalidate(patternOrKey: string | RegExp): Promise<number>;
    clear(): Promise<void>;
}