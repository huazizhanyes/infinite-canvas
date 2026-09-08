import type { CSSProperties } from "react";
import { useState } from "react";
import { Button, Modal, Space, Tag, Timeline } from "antd";
import { useVersionCheck } from "@/hooks/use-version-check";
import { APP_VERSION } from "@/constant/env";
import { flushCanvasPersistence } from "@/stores/canvas/use-canvas-store";
import { flushCanvasAssetSync } from "@/services/canvas-asset-sync";
import { flushSucaiCanvasSync } from "@/services/sucai-canvas-sync";

function getTagColor(type: string) {
    if (type === "新增") return "green";
    if (type === "修复") return "red";
    if (type === "调整") return "blue";
    if (type === "文档") return "purple";
    return "default";
}

function getReleaseTitle(version: string) {
    return version === "Unreleased" ? "未发布" : version;
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
    autoOpen?: boolean;
    showTrigger?: boolean;
};

export function VersionReleaseModal({ className, style, autoOpen = false, showTrigger = true }: VersionReleaseModalProps) {
    const { open, setOpen, openReleaseModal, latestVersion, releases, checking, hasNewVersion, checkLatestRelease } = useVersionCheck({ autoOpen });
    const [reloading, setReloading] = useState(false);

    const reloadApplication = async () => {
        setReloading(true);
        await Promise.race([Promise.allSettled([flushCanvasPersistence(), flushSucaiCanvasSync(), flushCanvasAssetSync()]), new Promise<void>((resolve) => window.setTimeout(resolve, 2000))]);
        window.location.reload();
    };

    return (
        <>
            {showTrigger ? (
                <button
                    type="button"
                    className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                    style={style}
                    onClick={openReleaseModal}
                    title="查看版本更新"
                >
                    <span className="relative inline-flex">
                        {APP_VERSION}
                        {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                    </span>
                </button>
            ) : null}
            <Modal title="版本更新" open={open} width={680} centered footer={null} onCancel={() => setOpen(false)}>
                <div className="mb-5 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="text-xs text-stone-500 dark:text-stone-400">当前版本</div>
                        <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{APP_VERSION}</div>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-stone-500 dark:text-stone-400">最新版本</div>
                            <button
                                type="button"
                                className="cursor-pointer bg-transparent p-0 text-[11px] font-normal text-stone-400 underline-offset-2 transition hover:text-stone-700 hover:underline dark:text-stone-500 dark:hover:text-stone-300"
                                onClick={() => void checkLatestRelease(true)}
                            >
                                {checking ? "检查中..." : "检查更新"}
                            </button>
                        </div>
                        <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{latestVersion}</div>
                    </div>
                </div>
                <div className="max-h-[56vh] overflow-y-auto pr-2">
                    <Timeline
                        items={releases.map((release) => ({
                            content: (
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{getReleaseTitle(release.version)}</span>
                                        <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {release.version === latestVersion ? <Tag color="green">最新</Tag> : null}
                                            {release.version === APP_VERSION ? <Tag>当前</Tag> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 space-y-1.5">
                                        {release.items.map((item, index) => (
                                            <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                                    {item.type}
                                                </Tag>
                                                <span className="min-w-0 flex-1">{item.content}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ),
                        }))}
                    />
                </div>
                <div className="mt-5 flex justify-end">
                    <Space>
                        <Button onClick={() => setOpen(false)} disabled={reloading}>
                            稍后再说
                        </Button>
                        <Button type="primary" loading={reloading} onClick={() => void reloadApplication()}>
                            立即更新
                        </Button>
                    </Space>
                </div>
            </Modal>
        </>
    );
}
