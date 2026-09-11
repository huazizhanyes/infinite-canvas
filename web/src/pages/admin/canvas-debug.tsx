import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Card, Empty, Input, List, Skeleton, Space, Statistic, Tag, Typography } from "antd";
import { Bug, ExternalLink, KeyRound, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { canvasAdminDebugApi, readAdminDebugToken, saveAdminDebugToken, type AdminCanvasProjectSummary, type AdminCanvasSnapshot, type AdminCanvasTaskDiagnostic } from "@/services/api/canvas-admin-debug";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

const { Text, Title } = Typography;

export default function CanvasDebugPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [adminToken, setAdminToken] = useState(() => readAdminDebugToken());
    const currentUserId = useUserStore((state) => state.user?.id || "");
    const importProject = useCanvasStore((state) => state.importProject);
    const [userId, setUserId] = useState(currentUserId);
    const [projectId, setProjectId] = useState("");
    const [projects, setProjects] = useState<AdminCanvasProjectSummary[]>([]);
    const [snapshot, setSnapshot] = useState<AdminCanvasSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState("");

    const selectedProject = useMemo(() => projects.find((item) => item.id === projectId) || null, [projectId, projects]);

    const loadProjects = async () => {
        const normalizedUserId = userId.trim();
        if (!normalizedUserId) return message.warning("请输入用户 ID");
        if (!adminToken.trim()) return message.warning("请先填写管理员令牌");
        setLoading(true);
        setError("");
        setSnapshot(null);
        try {
            const result = await canvasAdminDebugApi.listProjects(adminToken.trim(), normalizedUserId);
            setProjects(result);
            setProjectId(result[0]?.id || "");
            if (!result.length) message.info("该用户没有可读取的画布项目");
        } catch (cause) {
            const text = cause instanceof Error ? cause.message : "读取用户画布失败";
            setError(text);
            message.error(text);
        } finally {
            setLoading(false);
        }
    };

    const loadSnapshot = async (nextProjectId = projectId) => {
        if (!userId.trim() || !nextProjectId || !adminToken.trim()) return;
        setLoadingSnapshot(true);
        setError("");
        try {
            setSnapshot(await canvasAdminDebugApi.getProject(adminToken.trim(), userId.trim(), nextProjectId));
        } catch (cause) {
            const text = cause instanceof Error ? cause.message : "读取画布快照失败";
            setError(text);
            message.error(text);
        } finally {
            setLoadingSnapshot(false);
        }
    };

    useEffect(() => {
        if (projectId) void loadSnapshot(projectId);
        // 项目 ID 变化时只读取一次当前快照。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);

    const importDebugProject = async () => {
        if (!snapshot) return;
        setImporting(true);
        try {
            const importedProjectId = importProject({
                ...snapshot.project,
                title: "调试副本 · " + (snapshot.project.title || selectedProject?.title || snapshot.sourceProjectId),
                debugReadOnly: true,
                debugSourceUserId: snapshot.sourceUserId,
                debugSourceProjectId: snapshot.sourceProjectId,
            });
            message.success("已创建只读调试副本，媒体将通过管理员代看接口解析");
            navigate("/canvas/" + importedProjectId);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "创建调试副本失败");
        } finally {
            setImporting(false);
        }
    };

    const videoNodeCount = snapshot ? snapshot.project.nodes.filter((node) => node.type === "video").length : 0;

    return (
        <main className="h-full overflow-auto bg-[#f4f6f8] px-6 py-8 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="mx-auto max-w-6xl space-y-6">
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300"><Bug className="size-4" />Canvas diagnostics</div>
                        <Title level={2} className="!mb-1">画布问题复现</Title>
                        <Text type="secondary">按用户读取画布真实内容，导入只读调试副本复现问题；读取行为会写入管理端审计日志。</Text>
                    </div>
                    <Tag icon={<ShieldCheck className="size-3" />} color="blue">原项目只读 · 不扣费 · 不写回</Tag>
                </header>

                <Card className="border-0 shadow-sm" title="选择用户与项目">
                    <Input.Password
                        className="mb-3"
                        value={adminToken}
                        onChange={(event) => {
                            setAdminToken(event.target.value);
                            saveAdminDebugToken(event.target.value.trim());
                        }}
                        placeholder="管理员令牌（管理端登录后 Cookies 里的 token）"
                        prefix={<KeyRound className="size-4 text-slate-400" />}
                    />
                    <Alert
                        className="mb-3"
                        type="info"
                        showIcon
                        message={<span>管理端接口使用管理员账号签发的 JWT，与画布登录态不通用。先在管理端登录，F12 控制台执行 <code>document.cookie.match(/token=([^;]+)/)?.[1]</code> 复制结果粘贴到上方；令牌只保存在当前标签页会话。</span>}
                    />
                    <Space.Compact className="w-full">
                        <Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="用户 ID" prefix={<Search className="size-4 text-slate-400" />} onPressEnter={() => void loadProjects()} />
                        <Button type="primary" icon={<Search className="size-4" />} loading={loading} onClick={() => void loadProjects()}>读取项目</Button>
                    </Space.Compact>
                    {error ? <Alert className="mt-4" type="error" showIcon message={error} /> : null}
                    {projects.length ? (
                        <List
                            className="mt-4"
                            bordered
                            dataSource={projects}
                            rowKey="id"
                            renderItem={(item) => (
                                <List.Item className={item.id === projectId ? "!bg-cyan-50 dark:!bg-cyan-950/30" : ""} onClick={() => setProjectId(item.id)}>
                                    <List.Item.Meta title={<button type="button" className="text-left font-medium" onClick={() => setProjectId(item.id)}>{item.title || "未命名画布"}</button>} description={item.id + " · v" + (item.version ?? "-") + " · 更新于 " + formatDate(item.updated_at)} />
                                    {item.deleted_at ? <Tag>已删除</Tag> : <Tag color="green">有效</Tag>}
                                </List.Item>
                            )}
                        />
                    ) : loading ? <Skeleton active className="mt-4" /> : <Empty className="my-8" description="输入用户 ID 后读取项目（需要管理员账号）" />}
                </Card>

                {loadingSnapshot ? <Card><Skeleton active /></Card> : snapshot ? (
                    <>
                        <Card className="border-0 shadow-sm" title="快照概览" extra={<Button icon={<RefreshCw className="size-4" />} onClick={() => void loadSnapshot()}>刷新快照</Button>}>
                            <div className="grid gap-4 sm:grid-cols-4">
                                <Statistic title="节点" value={snapshot.project.nodes.length} />
                                <Statistic title="连线" value={snapshot.project.connections?.length || 0} />
                                <Statistic title="视频节点" value={videoNodeCount} />
                                <Statistic title="关联任务" value={snapshot.diagnostics.length} />
                            </div>
                            <Text type="secondary">项目更新时间：{formatDate(snapshot.capturedAt)} · 源项目：{snapshot.sourceProjectId} · 源用户：{snapshot.sourceUserId}</Text>
                        </Card>
                        <Card className="border-0 shadow-sm" title="视频节点诊断">
                            <DiagnosticList diagnostics={snapshot.diagnostics} />
                        </Card>
                        <div className="sticky bottom-4 flex justify-end">
                            <Button type="primary" size="large" icon={<ExternalLink className="size-4" />} loading={importing} onClick={() => void importDebugProject()}>导入只读调试副本</Button>
                        </div>
                    </>
                ) : null}
            </div>
        </main>
    );
}

function DiagnosticList({ diagnostics }: { diagnostics: AdminCanvasTaskDiagnostic[] }) {
    if (!diagnostics.length) return <Empty description="没有关联的视频任务" />;
    return <List dataSource={diagnostics} rowKey={(item) => item.taskId + "-" + (item.nodeId || "")} renderItem={(item) => <List.Item><List.Item.Meta title={<span>{item.nodeId || "未关联节点"} · {item.taskId}</span>} description={item.error?.message || (item.resultUrl ? "节点已有可播放结果地址" : "节点没有结果地址")} />{item.status ? <Tag color={taskColor(item.status)}>{item.status}</Tag> : null}</List.Item>} />;
}

function formatDate(value?: string) {
    if (!value) return "未知";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function taskColor(status: string) {
    if (/completed|success|succeeded/i.test(status)) return "green";
    if (/failed|error/i.test(status)) return "red";
    if (/queued|running|generating|processing/i.test(status)) return "blue";
    return "default";
}
