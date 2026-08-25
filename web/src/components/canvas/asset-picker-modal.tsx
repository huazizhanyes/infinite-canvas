import { useEffect, useMemo, useState } from "react";
import { Empty, Input, Modal, Pagination, Tag } from "antd";
import { Images, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { assetPreviewUrl, useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";

export type InsertAssetPayload = { kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number };

type Props = {
    open: boolean;
    defaultKind?: AssetKind | "all";
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, defaultKind, defaultTab, onInsert, onClose }: Props) {
    const initialKind = defaultKind || (defaultTab === "text" || defaultTab === "image" || defaultTab === "video" ? defaultTab : "all");
    return (
        <Modal title={<span className="inline-flex items-center gap-2 text-base"><Images className="size-5 text-sky-300" />选择资产</span>} open={open} onCancel={onClose} footer={null} width={980} destroyOnHidden styles={{ body: { padding: "0 28px 28px", minHeight: 520 } }}>
            <MyAssetsTab defaultKind={initialKind} onInsert={onInsert} />
        </Modal>
    );
}

const PAGE_SIZE = 8;

const kindOptions: Array<{ label: string; value: AssetKind | "all" }> = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
];

function PickerCard({ title, kind, cover, onClick }: { title: string; kind: string; cover: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-xl border border-slate-200/80 bg-white text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-500/70"
            onClick={onClick}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[16/10] w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
            ) : (
                <div className="flex aspect-[16/10] items-center justify-center bg-slate-100 p-3 text-center text-xs leading-5 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{title}</div>
            )}
            <div className="border-t border-slate-200/70 p-3 dark:border-slate-700/70">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-slate-800 dark:text-slate-100">{title}</span>
                    <Tag className="m-0 shrink-0 text-[10px]">{kind === "image" ? "图片" : kind === "video" ? "视频" : "文本"}</Tag>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-slate-950/55 group-hover:opacity-100">点击插入</div>
        </button>
    );
}

function MyAssetsTab({ defaultKind, onInsert }: { defaultKind: AssetKind | "all"; onInsert: (payload: InsertAssetPayload) => void }) {
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState(defaultKind);
    const [page, setPage] = useState(1);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((a) => a.kind === "text" || a.kind === "image" || a.kind === "video")
            .filter((a) => kindFilter === "all" || a.kind === kindFilter)
            .filter((a) => !query || [a.title, ...(a.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((v) => Math.min(v, maxPage));
    }, [filtered.length]);

    const handleInsert = async (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", content: asset.data.content, title: asset.title });
        } else if (asset.kind === "video") {
            const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
            onInsert({ kind: "video", url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height });
        } else {
            const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl || asset.coverUrl);
            onInsert({ kind: "image", dataUrl, storageKey: asset.data.storageKey, title: asset.title });
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-700/70 dark:bg-slate-900/60">
                <Input
                    className="min-w-[240px] flex-1"
                    size="middle"
                    prefix={<Search className="size-3.5 text-stone-400" />}
                    placeholder="搜索资产"
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
                <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-800">
                    {kindOptions.map((opt) => (
                        <Tag.CheckableTag
                            key={opt.value}
                            checked={kindFilter === opt.value}
                            className={cn("!m-0 !rounded-md !px-3 !py-1 text-xs", kindFilter === opt.value && "prompt-filter-tag is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(opt.value);
                            }}
                        >
                            {opt.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-between px-1 text-xs text-slate-500 dark:text-slate-400">
                <span>我的资产</span>
                <span>{filtered.length} 个</span>
            </div>

            {visible.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
                    {visible.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={assetPreviewUrl(asset)} onClick={() => void handleInsert(asset)} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有资产" className="py-12" />
            )}

            {filtered.length > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
        </div>
    );
}
