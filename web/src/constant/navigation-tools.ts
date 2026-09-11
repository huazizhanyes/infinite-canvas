import { Images, Maximize2 } from "lucide-react";

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
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
