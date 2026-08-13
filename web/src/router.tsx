import { lazy, Suspense } from "react";
import { createBrowserRouter, createHashRouter, Outlet } from "react-router-dom";

import UserLayout from "@/layouts/user-layout";

const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const ImagePage = lazy(() => import("@/pages/image"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));

function routeElement(element: React.ReactNode) {
    return <Suspense fallback={<div className="h-full min-h-0 bg-background" />}>{element}</Suspense>;
}

const routes = [
    {
        element: (
            <UserLayout>
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: routeElement(<CanvasPage />) },
            { path: "/image", element: routeElement(<ImagePage />) },
            { path: "/video", element: routeElement(<VideoPage />) },
            { path: "/assets", element: routeElement(<AssetsPage />) },
            { path: "/prompts", element: routeElement(<PromptsPage />) },
            { path: "/canvas", element: routeElement(<CanvasPage />) },
            { path: "/canvas/:id", element: routeElement(<CanvasProjectPage />) },
            { path: "/config", element: routeElement(<ConfigPage />) },
        ],
    },
    { path: "*", element: routeElement(<NotFound />) },
];

const basename = import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");
export const router = import.meta.env.VITE_HASH_ROUTER === "true" ? createHashRouter(routes) : createBrowserRouter(routes, { basename });
