export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f3f4f6",
            dot: "rgba(17,24,39,.18)",
            line: "rgba(17,24,39,.08)",
            selectionStroke: "#ffffff",
            selectionFill: "rgba(255,255,255,.08)",
        },
        node: {
            label: "#4b5563",
            fill: "#f9fafb",
            panel: "#ffffff",
            stroke: "#d1d5db",
            activeStroke: "#2563eb",
            placeholder: "#9ca3af",
            text: "#111827",
            muted: "#6b7280",
            faint: "#9ca3af",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#d1d5db",
            item: "#4b5563",
            itemHover: "#f3f4f6",
            activeBg: "#e5e7eb",
            activeText: "#111827",
        },
    },
    dark: {
        canvas: {
            background: "#111315",
            dot: "rgba(255,255,255,.16)",
            line: "rgba(255,255,255,.07)",
            selectionStroke: "#ffffff",
            selectionFill: "rgba(255,255,255,.10)",
        },
        node: {
            label: "#c4c7cc",
            fill: "#242628",
            panel: "#1a1c1e",
            stroke: "#45494e",
            activeStroke: "#60a5fa",
            placeholder: "#858a91",
            text: "#f1f3f5",
            muted: "#a7abb1",
            faint: "#6f747b",
        },
        toolbar: {
            panel: "rgba(28,30,32,.97)",
            border: "#45494e",
            item: "#c4c7cc",
            itemHover: "#2a2d30",
            activeBg: "#33373b",
            activeText: "#f1f3f5",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
