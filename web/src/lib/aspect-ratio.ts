/**
 * 画幅比例的统一定义：16:9 永远排第一位，也是切换模型后的默认值。
 * 模型不支持 16:9 时保持后端下发的原始顺序，用第一项兜底。
 */
export const PREFERRED_ASPECT_RATIO = "16:9";

/** 把 16:9 排到第一位，其余保持原顺序。列表顺序与默认值共用同一个结果。 */
export function sortAspectRatios<T>(items: readonly T[], valueOf: (item: T) => string): T[] {
    const preferred = items.filter((item) => valueOf(item) === PREFERRED_ASPECT_RATIO);
    if (!preferred.length) return [...items];
    return [...preferred, ...items.filter((item) => valueOf(item) !== PREFERRED_ASPECT_RATIO)];
}

/** 默认比例：16:9 优先，模型没有 16:9 时用列表第一项。 */
export function defaultAspectRatio(ratios: readonly string[], fallback = PREFERRED_ASPECT_RATIO): string {
    return sortAspectRatios(ratios, (ratio) => ratio)[0] || fallback;
}
