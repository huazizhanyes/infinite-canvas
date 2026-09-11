import { Bot, Bug, Home, Menu } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { SHOW_AGENT_UI, SHOW_CANVAS_DEBUG_UI, SUCAI_HOME_URL, SUCAI_INTEGRATION } from "@/constant/env";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useCanvasHostTaskStore } from "@/stores/canvas/use-canvas-host-task-store";
import { flushCanvasPersistence } from "@/stores/canvas/use-canvas-store";
import { flushSucaiCanvasSync } from "@/services/sucai-canvas-sync";
import { postCanvasHostMessage, readCanvasHostMessage } from "@/lib/canvas-host-bridge";
import { lazy, Suspense } from "react";

const AppConfigModal = lazy(() => import("@/components/layout/app-config-modal").then((module) => ({ default: module.AppConfigModal })));

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
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
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
                <header className="sticky top-0 z-20 h-16 shrink-0 border-b border-stone-200/80 bg-background/85 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#05070b]/85">
                    <div className="mx-auto flex h-full max-w-[1480px] items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            {!SUCAI_INTEGRATION || window.parent === window ? (
                                <a
                                    href={SUCAI_HOME_URL}
                                    className="mr-3 flex h-16 shrink-0 items-center gap-2 rounded-full px-3 text-sm text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 md:mr-5 dark:text-stone-400 dark:hover:bg-white/[0.05] dark:hover:text-stone-100"
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

                            <nav className="hide-scrollbar hidden h-16 min-w-0 items-center gap-2 overflow-x-auto md:flex">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={tool.path}
                                            className={cn("group relative flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] leading-6 transition duration-200", navigationAccentClass(tool.slug, active))}
                                        >
                                            <Icon className={cn("size-4 transition", active ? "text-cyan-600 dark:text-cyan-300" : "text-stone-400 dark:text-stone-500 group-hover:text-stone-700 dark:group-hover:text-stone-300")} />
                                            <span className="truncate">{tool.label}</span>
                                            {active ? <span className="absolute -bottom-2 left-1/2 h-px w-5 -translate-x-1/2 rounded-full bg-cyan-500 shadow-[0_0_12px_rgba(34,211,238,0.65)] dark:bg-cyan-300" /> : null}
                                        </Link>
                                    );
                                })}
                                {SHOW_CANVAS_DEBUG_UI ? (
                                    <Link to="/admin/canvas-debug" className={cn("relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px", pathname === "/admin/canvas-debug" ? "font-medium text-amber-600 after:bg-amber-500 dark:text-amber-300 dark:after:bg-amber-400" : "text-stone-500 after:bg-transparent hover:text-amber-600 dark:text-stone-400 dark:hover:text-amber-300")}>
                                        <Bug className="size-4" />
                                        <span>画布问题复现</span>
                                    </Link>
                                ) : null}
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
            {isConfigOpen ? (
                <Suspense fallback={null}>
                    <AppConfigModal />
                </Suspense>
            ) : null}
        </>
    );
}

function navigationAccentClass(_slug: NavigationToolSlug, active: boolean) {
    return active
        ? "bg-stone-100/90 font-medium text-stone-950 dark:bg-white/[0.06] dark:text-white"
        : "text-stone-500 hover:bg-stone-100/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/[0.045] dark:hover:text-stone-100";
}
