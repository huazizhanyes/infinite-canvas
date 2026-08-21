import { useRef, useState, type CSSProperties, type TextareaHTMLAttributes } from "react";
import { Button, Modal } from "antd";
import { Maximize2 } from "lucide-react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
    value: string;
    onChange: (value: string) => void;
    title?: string;
    wrapperClassName?: string;
    wrapperStyle?: CSSProperties;
};

export function CanvasExpandableTextarea({ value, onChange, title = "编辑内容", className, style, wrapperClassName, wrapperStyle, ...props }: Props) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [open, setOpen] = useState(false);
    const [selection, setSelection] = useState({ start: 0, end: 0 });

    const openEditor = () => {
        const textarea = textareaRef.current;
        setSelection({ start: textarea?.selectionStart ?? value.length, end: textarea?.selectionEnd ?? value.length });
        setOpen(true);
    };

    return (
        <>
            <div className={`relative min-h-0 ${wrapperClassName || ""}`} style={wrapperStyle}>
                <textarea
                    {...props}
                    ref={textareaRef}
                    value={value}
                    className={`${className || ""} pr-10`}
                    style={style}
                    onChange={(event) => onChange(event.target.value)}
                />
                <Button
                    type="text"
                    size="small"
                    aria-label={`放大${title}`}
                    title={`放大${title}`}
                    icon={<Maximize2 className="size-3.5" />}
                    className="!absolute right-1 top-1 z-10 !grid !size-7 !min-w-7 !place-items-center !p-0 opacity-70 hover:!opacity-100"
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={openEditor}
                />
            </div>
            <Modal title={title} open={open} footer={null} centered width="min(92vw, 900px)" onCancel={() => setOpen(false)}>
                <textarea
                    {...props}
                    autoFocus
                    value={value}
                    className={`${className || ""} !h-[min(68vh,560px)] !w-full resize-none pr-3`}
                    style={style}
                    onChange={(event) => onChange(event.target.value)}
                    onFocus={(event) => {
                        event.currentTarget.setSelectionRange(selection.start, selection.end);
                    }}
                />
            </Modal>
        </>
    );
}
