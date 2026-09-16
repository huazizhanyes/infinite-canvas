import axios from "axios";

const API_BASE = String(import.meta.env.VITE_SUCAI_API_BASE || import.meta.env.VITE_SUCAI_CANVAS_API_BASE || "/flash-api")
    .trim()
    .replace(/\/canvas\/?$/, "")
    .replace(/\/+$/, "");

export async function getPublicSystemConfigs(signal?: AbortSignal) {
    const response = await axios.get<Record<string, unknown>>(`${API_BASE}/system/config/public`, {
        signal,
        params: { _: Date.now() },
    });
    return response.data || {};
}
