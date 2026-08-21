import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SUCAI_HOME_URL } from "@/constant/env";

const OPEN_EVENT = "sucai:ai-membership:open";

export function openAiMembershipModal() {
    window.dispatchEvent(new Event(OPEN_EVENT));
}

export function AiMembershipModal() {
    const [open, setOpen] = useState(false);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const membershipUrl = useMemo(() => {
        const homeUrl = new URL(SUCAI_HOME_URL, window.location.origin);
        return new URL("ai-membership/embed", homeUrl).toString();
    }, []);

    useEffect(() => {
        const show = () => setOpen(true);
        window.addEventListener(OPEN_EVENT, show);
        return () => window.removeEventListener(OPEN_EVENT, show);
    }, []);

    useEffect(() => {
        if (!open) return;
        const close = (event: MessageEvent) => {
            if (event.source !== frameRef.current?.contentWindow) return;
            if (event.data?.type === "sucai:ai-membership:close") setOpen(false);
        };
        window.addEventListener("message", close);
        return () => window.removeEventListener("message", close);
    }, [open]);

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-[2000] bg-[#0b0d10]" role="dialog" aria-modal="true" aria-label="AI 会员中心">
            <iframe ref={frameRef} src={membershipUrl} title="AI 会员中心" className="h-full w-full border-0 bg-[#0b0d10]" />
        </div>,
        document.body,
    );
}
