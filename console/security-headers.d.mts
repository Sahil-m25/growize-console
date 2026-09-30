/* Types for security-headers.mjs (M18-S15-H1). */
export declare const CSP_ALLOW: Readonly<Record<string, readonly string[]>>;
export declare function pageCsp(nonce: string, options?: { dev?: boolean }): string;
export declare function apiCsp(): string;
export declare const SECURITY_HEADERS: ReadonlyArray<{ readonly key: string; readonly value: string }>;
export declare const REQUIRED_SECURITY_HEADERS: readonly string[];
export declare function nextHeaderRules(): Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
