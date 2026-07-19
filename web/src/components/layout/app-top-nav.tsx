import { Bot, Home, Menu } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { SHOW_AGENT_UI, SUCAI_HOME_URL } from "@/constant/env";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";

export function AppTopNav() {
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname === "/" ? "canvas" : pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (!SHOW_AGENT_UI || autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            <a
                                href={SUCAI_HOME_URL}
                                className="mr-4 flex h-14 shrink-0 items-center gap-2 text-sm text-stone-500 transition hover:text-stone-950 md:mr-7 dark:text-stone-400 dark:hover:text-stone-100"
                                aria-label="返回主页"
                                title="返回主页"
                            >
                                <Home className="size-4" />
                                <span className="hidden sm:inline">返回主页</span>
                            </a>
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
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active
                                                    ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="truncate">{tool.label}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            {SHOW_AGENT_UI ? (
                                <Tooltip title={panelOpen ? "收起 Agent" : "打开 Agent"}>
                                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label="打开 Agent" />
                                </Tooltip>
                            ) : null}
                            <UserStatusActions showDocs={false} />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
