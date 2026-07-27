export type ImageAspectOption = {
    value: string;
    label: string;
    size: string;
    width: number;
    height: number;
    icon: "square" | "landscape" | "portrait" | "auto";
};

export const imageQualityOptionDetails = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];

export const imageAspectOptionDetails: ImageAspectOption[] = [
    { value: "1:1", label: "1:1", size: "1024x1024", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", size: "1536x1024", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", size: "1024x1536", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", size: "1360x1024", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", size: "1024x1360", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", size: "1824x1024", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", size: "1024x1824", width: 1024, height: 1824, icon: "portrait" },
    { value: "auto", label: "auto", size: "auto", width: 0, height: 0, icon: "auto" },
];

export const imageQualityOptions = imageQualityOptionDetails.map((item) => ({ value: item.value, label: item.label }));
export const imageAspectOptions = imageAspectOptionDetails.map((item) => ({ value: item.size, label: item.label }));

export function normalizeImageCount(value: unknown, maxCount = 5) {
    const normalizedMaxCount = Math.max(1, Math.floor(maxCount));
    return Math.max(1, Math.min(normalizedMaxCount, Math.floor(Math.abs(Number(value)) || 1)));
}

export function imageQualityLabel(value: string) {
    return imageQualityOptionDetails.find((item) => item.value === value)?.label || value;
}

export function imageSizeLabel(size: string) {
    return imageAspectOptionDetails.find((item) => item.size === size || item.value === size)?.label || size;
}
