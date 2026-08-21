import type { CSSProperties } from "react";
import { Gem, Keyboard, LogIn, Puzzle, Settings2 } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { UserAssetMenu } from "@/components/layout/user-asset-menu";
import { CanvasLoginModal, requestCanvasLogin } from "@/components/layout/canvas-login-modal";
import { SUCAI_INTEGRATION } from "@/constant/env";
import { useUserStore } from "@/stores/use-user-store";
import { openAiMembershipModal } from "@/components/layout/ai-membership-modal";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const user = useUserStore((state) => state.user);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            <button
                type="button"
                className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-[11px] font-semibold text-amber-500 transition hover:-translate-y-px hover:bg-amber-500/10 hover:text-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 [&_svg]:drop-shadow-[0_2px_4px_rgba(180,120,18,.3)]"
                onClick={openAiMembershipModal}
                aria-label="AI 会员中心"
                title="AI 会员中心"
            >
                <Gem className="size-4" />
                <span>会员中心</span>
            </button>
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label="节点插件" title="节点插件">
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {SUCAI_INTEGRATION && !user ? (
                <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-cyan-700 transition hover:bg-cyan-500/10 dark:text-cyan-300" onClick={requestCanvasLogin}>
                    <LogIn className="size-3.5" />
                    登录
                </button>
            ) : null}
            <UserAssetMenu style={iconStyle} />
            <CanvasLoginModal />
        </div>
    );
}
