/** Content-hashed `public/` asset urls (#1194). Server-side resolver; the browser bundle drops setAssetUrlProvider and `asset` returns its argument. */
export function setAssetUrlProvider(fn: (path: string) => string): void;
export function asset(path: string): string;
