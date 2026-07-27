export function cacheObjectUrl(cache: Map<string, string>, key: string, blob: Blob) {
    const previous = cache.get(key);
    const url = URL.createObjectURL(blob);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    cache.set(key, url);
    return url;
}

export function revokeCachedObjectUrl(cache: Map<string, string>, key: string) {
    const url = cache.get(key);
    if (url) URL.revokeObjectURL(url);
    cache.delete(key);
}
