/**
 * 画布标签页「在线心跳」。
 *
 * 短剧「同步到画布」要保证同步期间画布页面是关着的：画布会把内存里的节点整份写回云端，
 * 如果它正好开着、又在同步后发生任何编辑（拖动、平移视口都会触发保存），就会把刚同步进去的节点覆盖掉。
 *
 * 浏览器不允许页面去关闭别人的标签页，所以这里只提供"是否开着"的事实，由调用方决定怎么拦：
 * - 每 3 秒写一次时间戳；
 * - 关闭/离开页面时写 0，让对方立刻判定为已关闭（而不是等心跳超时）。
 */

export const CANVAS_TAB_PRESENCE_KEY = "canvas:tab-presence";

const HEARTBEAT_MS = 3000;

function write(at: number) {
    try {
        window.localStorage.setItem(CANVAS_TAB_PRESENCE_KEY, String(at));
    } catch {
        /* 隐私模式下 localStorage 不可用：只是拿不到在线信号，不影响画布本身 */
    }
}

/** 开始心跳，返回停止函数（组件卸载时调用） */
export function startCanvasTabPresence() {
    write(Date.now());
    const timer = window.setInterval(() => write(Date.now()), HEARTBEAT_MS);
    const markClosed = () => {
        window.clearInterval(timer);
        write(0);
    };
    window.addEventListener("pagehide", markClosed);
    window.addEventListener("beforeunload", markClosed);
    return () => {
        markClosed();
        window.removeEventListener("pagehide", markClosed);
        window.removeEventListener("beforeunload", markClosed);
    };
}
