import { useState } from "react";
import { Modal, Tooltip } from "antd";
import { BookOpenText } from "lucide-react";

export const CANVAS_TUTORIAL_VIDEO_URL = "https://oss.hzzy.xyz/teach-canvas.mp4";

/** 使用教程入口：放在会员中心/积分消耗旁边的共用头部工具条里，点击弹出视频教程。 */
export function CanvasTutorialButton({ style }: { style?: React.CSSProperties }) {
    const [open, setOpen] = useState(false);
    return <>
        <Tooltip title="查看使用教程">
            <button
                type="button"
                className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-stone-600 transition hover:bg-stone-500/10 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white"
                style={style}
                onClick={() => setOpen(true)}
                aria-label="使用教程"
            >
                <BookOpenText className="size-4" />
                <span>教程</span>
            </button>
        </Tooltip>
        <Modal title="使用教程" open={open} onCancel={() => setOpen(false)} footer={null} centered width={880} destroyOnHidden>
            <div className="border-t border-stone-200 pt-4 dark:border-stone-800">
                <video className="max-h-[68vh] w-full rounded-lg bg-black" src={CANVAS_TUTORIAL_VIDEO_URL} controls autoPlay playsInline />
            </div>
        </Modal>
    </>;
}
