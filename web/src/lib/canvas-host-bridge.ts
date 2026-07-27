type HostBridgeConfig = {
    source: "flash-creator-host";
    nonce: string;
    origin: string;
};

type HostMessage = {
    source: "flash-creator-host";
    nonce: string;
    type: string;
    [key: string]: unknown;
};

let cachedConfig: HostBridgeConfig | null | undefined;

export function getCanvasHostBridgeConfig(): HostBridgeConfig | null {
    if (cachedConfig !== undefined) return cachedConfig;
    try {
        const params = new URLSearchParams(window.location.search);
        const nonce = params.get("host_nonce") || "";
        const origin = params.get("host_origin") || "";
        const validOrigin = origin === "" || /^https?:\/\//.test(origin);
        cachedConfig = nonce.length >= 16 && validOrigin ? { source: "flash-creator-host", nonce, origin } : null;
    } catch {
        cachedConfig = null;
    }
    return cachedConfig;
}

export function postCanvasHostMessage(message: { type: string; [key: string]: unknown }) {
    const config = getCanvasHostBridgeConfig();
    if (!config || window.parent === window) return;
    window.parent.postMessage({ source: "infinite-canvas", nonce: config.nonce, ...message }, config.origin || "*");
}

export function readCanvasHostMessage(event: MessageEvent): HostMessage | null {
    const config = getCanvasHostBridgeConfig();
    if (!config || event.source !== window.parent) return null;
    if (config.origin && event.origin !== config.origin) return null;
    if (!event.data || typeof event.data !== "object") return null;
    const data = event.data as Partial<HostMessage>;
    if (data.source !== "flash-creator-host" || data.nonce !== config.nonce || typeof data.type !== "string") return null;
    return data as HostMessage;
}
