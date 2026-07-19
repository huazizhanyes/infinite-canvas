import { createBrowserRouter, createHashRouter, Outlet } from "react-router-dom";

import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";

const routes = [
    {
        element: (
            <UserLayout>
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <CanvasPage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
];

const basename = import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");
export const router = import.meta.env.VITE_HASH_ROUTER === "true" ? createHashRouter(routes) : createBrowserRouter(routes, { basename });
