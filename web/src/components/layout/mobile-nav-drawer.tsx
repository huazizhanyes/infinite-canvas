import { Drawer } from "antd";
import { Link } from "react-router-dom";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    return (
        <Drawer title="导航" placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {navigationTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link key={tool.slug} to={tool.path} onClick={onClose} className={cn("flex items-center gap-3 rounded-lg px-3 py-3 text-base transition", mobileNavigationAccentClass(tool.slug, active))}>
                            <Icon className={cn("size-5", mobileNavigationIconAccentClass(tool.slug))} />
                            <span>{tool.label}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}

function mobileNavigationAccentClass(slug: NavigationToolSlug, active: boolean) {
    if (slug === "canvas") return active ? "bg-cyan-500/10 font-medium text-cyan-700 dark:text-cyan-300" : "text-stone-600 hover:bg-cyan-500/10 hover:text-cyan-700 dark:text-stone-300 dark:hover:text-cyan-300";
    if (slug === "assets") return active ? "bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300" : "text-stone-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-stone-300 dark:hover:text-emerald-300";
    return active ? "bg-violet-500/10 font-medium text-violet-700 dark:text-violet-300" : "text-stone-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-stone-300 dark:hover:text-violet-300";
}

function mobileNavigationIconAccentClass(slug: NavigationToolSlug) {
    if (slug === "canvas") return "text-cyan-600 dark:text-cyan-300";
    if (slug === "assets") return "text-emerald-600 dark:text-emerald-300";
    return "text-violet-600 dark:text-violet-300";
}
