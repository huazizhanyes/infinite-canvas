import { Images, Maximize2, Settings2 } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        path: "/",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "assets",
        path: "/assets",
        label: "我的资产",
        icon: Images,
    },
    {
        slug: "config",
        path: "/config",
        label: "配置",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
