import { Bot, Home, Menu } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { SHOW_AGENT_UI, SUCAI_HOME_URL, SUCAI_INTEGRATION } from "@/constant/env";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasHostTaskStore } from "@/stores/canvas/use-canvas-host-task-store";
import { flushCanvasPersistence } from "@/stores/canvas/use-canvas-store";
import { flushSucaiCanvasSync } from "@/services/sucai-canvas-sync";
import { postCanvasHostMessage, readCanvasHostMessage } from "@/lib/canvas-host-bridge";

export function AppTopNav() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const hostReadyRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const canvasTasks = useCanvasHostTaskStore((state) => state.tasks);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname === "/" ? "canvas" : pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (!SHOW_AGENT_UI || autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    useEffect(() => {
        if (!SUCAI_INTEGRATION || window.parent === window) return;
        postCanvasHostMessage({ type: "route-change", pathname });
    }, [pathname]);

    const sendTaskSnapshot = useCallback(() => {
        if (!SUCAI_INTEGRATION || window.parent === window) return;
        postCanvasHostMessage({ type: "task-snapshot", tasks: canvasTasks.slice(0, 30) });
    }, [canvasTasks]);

    useEffect(() => {
        sendTaskSnapshot();
        if (!SUCAI_INTEGRATION || window.parent === window) return;
        const timer = window.setInterval(sendTaskSnapshot, 5000);
        return () => window.clearInterval(timer);
    }, [sendTaskSnapshot]);

    useEffect(() => {
        const handlePageHide = () => {
            void flushCanvasPersistence();
            void flushSucaiCanvasSync();
        };
        window.addEventListener("pagehide", handlePageHide);
        return () => window.removeEventListener("pagehide", handlePageHide);
    }, []);

    useEffect(() => {
        if (!SUCAI_INTEGRATION || window.parent === window || hostReadyRef.current) return;
        hostReadyRef.current = true;
        postCanvasHostMessage({ type: "canvas-ready", pathname });
    }, [pathname]);

    useEffect(() => {
        if (!SUCAI_INTEGRATION || window.parent === window) return;
        const handleHostMessage = async (event: MessageEvent) => {
            const data = readCanvasHostMessage(event);
            if (!data) return;
            if (data.type === "request-task-snapshot") {
                sendTaskSnapshot();
                return;
            }
            if (data.type === "navigate" && data.pathname === "/canvas") navigate("/canvas");
            if (data.type === "flush-persistence" && typeof data.requestId === "string") {
                const results = await Promise.allSettled([flushCanvasPersistence(), flushSucaiCanvasSync()]);
                const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
                postCanvasHostMessage({
                    type: "flush-complete",
                    requestId: data.requestId,
                    ok: !rejected && results.every((result) => result.status === "fulfilled" && result.value !== false),
                    ...(rejected ? { error: rejected.reason instanceof Error ? rejected.reason.message : "画布保存失败" } : {}),
                });
            }
        };
        window.addEventListener("message", handleHostMessage);
        return () => window.removeEventListener("message", handleHostMessage);
    }, [navigate, sendTaskSnapshot]);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            {!SUCAI_INTEGRATION ? (
                                <a
                                    href={SUCAI_HOME_URL}
                                    className="mr-4 flex h-14 shrink-0 items-center gap-2 text-sm text-stone-500 transition hover:text-stone-950 md:mr-7 dark:text-stone-400 dark:hover:text-stone-100"
                                    aria-label="返回主页"
                                    title="返回主页"
                                >
                                    <Home className="size-4" />
                                    <span className="hidden sm:inline">返回主页</span>
                                </a>
                            ) : null}
                            <button
                                type="button"
                                className="inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar hidden h-14 min-w-0 items-center gap-7 overflow-x-auto md:flex">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={tool.path}
                                            className={cn("relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px", navigationAccentClass(tool.slug, active))}
                                        >
                                            <Icon className={cn("size-4", navigationIconAccentClass(tool.slug))} />
                                            <span className="truncate">{tool.label}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className={cn("flex h-9 min-w-0 items-center justify-end gap-2 whitespace-nowrap", SUCAI_INTEGRATION ? "absolute right-4 top-1/2 -translate-y-1/2" : "my-auto justify-self-end")}>
                            {SHOW_AGENT_UI ? (
                                <Tooltip title={panelOpen ? "收起 Agent" : "打开 Agent"}>
                                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label="打开 Agent" />
                                </Tooltip>
                            ) : null}
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}

function navigationAccentClass(slug: NavigationToolSlug, active: boolean) {
    if (slug === "canvas") return active ? "font-medium text-cyan-600 after:bg-cyan-500 dark:text-cyan-300 dark:after:bg-cyan-400" : "text-stone-500 after:bg-transparent hover:text-cyan-600 dark:text-stone-400 dark:hover:text-cyan-300";
    if (slug === "assets") return active ? "font-medium text-emerald-600 after:bg-emerald-500 dark:text-emerald-300 dark:after:bg-emerald-400" : "text-stone-500 after:bg-transparent hover:text-emerald-600 dark:text-stone-400 dark:hover:text-emerald-300";
    return active ? "font-medium text-violet-600 after:bg-violet-500 dark:text-violet-300 dark:after:bg-violet-400" : "text-stone-500 after:bg-transparent hover:text-violet-600 dark:text-stone-400 dark:hover:text-violet-300";
}

function navigationIconAccentClass(slug: NavigationToolSlug) {
    if (slug === "canvas") return "text-cyan-600 dark:text-cyan-300";
    if (slug === "assets") return "text-emerald-600 dark:text-emerald-300";
    return "text-violet-600 dark:text-violet-300";
}
