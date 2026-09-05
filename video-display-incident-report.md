# 视频生成完成但单设备不展示：证据报告

## 结论

当前代码证据不支持“视频没有生成”或“用户网络整体有问题”。更符合现象的解释是：

1. 服务器重启时，报价请求短暂返回 502；刷新后报价恢复。这个 502 发生在生成前，不能直接证明后续视频结果损坏。
2. 视频生成任务由后端持久化并由后台 reconciler 轮询上游、归档到服务器存储/OSS 后才标记 `completed`。前端最终使用后端返回的 `resultUrl`，不是用户浏览器上传的原视频。
3. 用户设备显示“视频加载失败”，而同一账号在另一台电脑能正常展示，说明任务记录和结果地址大概率存在；异常更可能发生在该设备访问结果地址时（旧缓存、代理/梯子、跨域或 Range 请求、浏览器解码差异），或该设备画布节点仍保留旧/失效地址。
4. 仅凭两张截图无法区分 HTTP 404/502、CORS、Range、MIME、缓存或解码错误，因为前端把所有 `<video onError>` 都统一显示为“视频加载失败”，没有展示 URL、HTTP 状态或 MediaError 细节。

## 代码链路（可复现）

### 1. 报价与生成

- 前端视频生成先调用报价接口，再 `POST /canvas/v1/video/tasks`：`web/src/services/api/canvas-video.ts`。
- 后端创建 `canvas_video_tasks` 记录；任务先进入 `queued/submitting`，由 `CanvasVideoReconcilerService` 每 10 秒执行提交、轮询、归档和计费对账：`flash_nest/src/canvas-video/canvas-video-reconciler.service.ts`。
- 服务重启后，后台会继续处理可恢复任务：`markStaleSubmissions`、`submitRecoverableTasks`、`pollUpstreamTasks`、`retryArchives`。

### 2. 上游完成到可播放地址

- 上游状态 3（成功）时，后端读取 `outputs` 中的 HTTP URL；没有 URL 会将任务标记为 `UPSTREAM_OUTPUT_MISSING` 并失败退款。
- 有 URL 时任务先变为 `archiving`，后端下载上游视频，再写入 OSS（当前生产配置优先 OSS）；写入成功才更新：`status=completed`、`result_url`、`storage_key`、`storage_type`、`mime_type`。
- 归档失败不会伪装成完成，而是保持 `archiving` 并按退避时间重试。
- 相关实现：`flash_nest/src/canvas-video/canvas-video.service.ts:753-824`、`flash_nest/src/canvas-video/canvas-video-storage.service.ts:123-180`。

### 3. 前端展示

- 前端轮询 `GET /canvas/v1/video/tasks/:id`；任务完成后要求 `resultUrl`，缺失则抛出“视频任务已完成但没有可播放地址”：`web/src/services/api/canvas-video.ts:291-336`。
- 完成后节点保存 `metadata.content = resultUrl`，并渲染 `<video src=...>`：`web/src/pages/canvas/project.tsx:4718-4733`、`web/src/components/canvas/canvas-node.tsx:905-930`。
- `<video>` 的任何底层错误都只进入 `loadError`，统一显示“视频加载失败”：`web/src/components/canvas/canvas-node.tsx:872-879, 907-930`。

## 为什么“另一台电脑正常”很关键

这一步已经排除了几类高概率原因：

- 不是任务必然失败：同一账号的任务至少能在另一台电脑展示。
- 不是结果文件必然不存在：后端已返回可播放地址，另一台设备能读取。
- 不是账号权限普遍错误：同一账号可访问。

仍然可能存在的设备侧差异：

- 用户设备的代理/梯子在生成后关闭，结果域名或静态文件域名仍被错误代理、缓存或拦截。
- 浏览器缓存了失败响应；当前静态视频响应配置为 `immutable`、`max-age=1y`，失败后重试只改变 React key，不保证中间代理缓存已清除。
- 某些浏览器/代理对视频 `Range` 请求、`Content-Type: video/mp4`、跨域响应处理不同。
- 用户设备画布仍显示旧节点内容；画布跨设备合并按 `updatedAt` 选本地/远端项目，旧设备本地状态可能覆盖或延迟同步：`web/src/services/sucai-canvas-sync.ts:123-136`。

## 必须补采的证据（才能定责）

对同一任务 ID，在用户设备失败时记录：

1. 浏览器 DevTools Network 中 `resultUrl` 的请求 URL、状态码、响应 `Content-Type`、`Content-Length`、`Accept-Ranges`、是否命中缓存、是否发生 CORS 错误。
2. Console 中 `HTMLMediaElement.error.code/message`、是否出现 `MEDIA_ERR_SRC_NOT_SUPPORTED`。
3. 失败设备与正常设备访问同一 `resultUrl` 的 `HEAD`/首个 `Range: bytes=0-1` 响应对比。
4. 后端按任务 ID 查询：`status/result_url/storage_key/storage_type/mime_type/archive_attempts/error_code/error_message`，以及事件列表中的 `ARCHIVE_STARTED/ARCHIVE_COMPLETED/ARCHIVE_FAILED`。
5. 失败时用户画布节点的 `metadata.content` 是否等于任务 `resultUrl`，避免把旧 URL 误当成新结果。

## 推荐的最小复现

1. 在设备 A 创建任务，记录任务 ID 和 `resultUrl`。
2. 任务完成后，在设备 A、设备 B 分别直接打开同一 `resultUrl`，再在画布内播放。
3. 对两台设备执行同样的 `HEAD` 和 `Range` 请求，比较状态码、响应头和首字节。
4. 清空设备 A 对该域名的站点数据/禁用代理后重新打开；若恢复，根因在缓存/代理链路，而不是生成链路。

## 当前能确认与不能确认

### 已确认

- 502 出现在服务器重启附近的报价阶段。
- 后端有任务持久化、重启恢复、上游轮询和归档机制。
- 只有归档成功才写入 `completed + result_url`。
- 前端统一把媒体加载底层错误显示成“视频加载失败”。
- 同一账号在另一台电脑可正常显示。

### 尚未确认

- 用户设备失败请求的具体 HTTP 状态、响应头和浏览器 MediaError。
- 失败设备是否命中了旧缓存、代理/梯子或跨域/Range 中间层。
- 用户画布节点是否保存了与任务记录不一致的旧 URL。

## 不应作出的结论

在拿到上述 Network、Console 和任务事件证据前，不能断言“上游生成失败”“OSS 文件丢失”“用户网络有问题”或“前端一定有 bug”。
