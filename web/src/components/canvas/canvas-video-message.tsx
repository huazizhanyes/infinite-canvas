import { useEffect, useState } from "react";

import { getPublicSystemConfigs } from "@/services/api/system-config";

const REFRESH_INTERVAL_MS = 60_000;

export function CanvasVideoMessage() {
    const [message, setMessage] = useState("");

    useEffect(() => {
        let active = true;
        let controller: AbortController | null = null;

        const load = async () => {
            controller?.abort();
            controller = new AbortController();
            try {
                const configs = await getPublicSystemConfigs(controller.signal);
                if (active) setMessage(String(configs.canvas_video_message || "").trim());
            } catch {
                // Keep the last successful message when a refresh fails.
            }
        };

        void load();
        const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
        return () => {
            active = false;
            controller?.abort();
            window.clearInterval(timer);
        };
    }, []);

    if (!message) return null;
    return (
        <div
            className="pointer-events-none flex h-9 min-w-0 max-w-[440px] shrink items-center gap-2.5 overflow-hidden rounded-full border border-amber-300/60 bg-amber-50/95 px-3.5 text-[13px] font-bold text-amber-800 shadow-lg backdrop-blur dark:border-amber-300/20 dark:bg-amber-300/[0.08] dark:text-amber-100"
            title={message}
        >
            <span className="size-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,.14)]" />
            <span className="min-w-0 truncate whitespace-nowrap">{message}</span>
        </div>
    );
}
