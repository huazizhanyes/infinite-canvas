import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

export type CanvasTemplateId = "character-image" | "scene-image" | "prop-image" | "video-flow";

export type CanvasTemplateDefinition = {
    id: CanvasTemplateId;
    title: string;
    description: string;
    kind: "image" | "video";
};

export const CANVAS_TEMPLATES: CanvasTemplateDefinition[] = [
    { id: "character-image", title: "人物", description: "", kind: "image" },
    { id: "scene-image", title: "场景", description: "", kind: "image" },
    { id: "prop-image", title: "道具", description: "", kind: "image" },
    { id: "video-flow", title: "视频", description: "", kind: "video" },
];

const CHARACTER_PROMPT = `【画面类型】人物资产设定图，横向角色设定表，纯白色背景，统一风格。
【人物身份】古风美女，年轻女子，气质清冷。
【固定外貌】鹅蛋脸，眉眼清秀，黑色长发半束，发间点缀银色花簪，肤色白皙，身形修长。
【固定服装】浅青色广袖长裙，白色内衬，腰系银色宫绦，外披薄纱轻衫，整体优雅利落。
【画面布局】画面包含正面全身、侧面全身、背面全身三视图，右下角增加人物大头近景展示。四个区域必须是同一个人物、同一服装、同一发型和同一体型比例。三视图完整展示人物全身，大头近景清楚展示五官、眼神、发饰和表情。
【背景要求】背景必须为纯白色，不出现花园、建筑、家具、植物、天空、地面纹理、渐变、光斑、阴影布景或其他环境元素。不要虚化背景，不要生成摄影棚背景。
【光影要求】使用柔和均匀的正面棚拍光，人物轮廓清楚，服装材质和发饰细节清晰，人物边缘不要产生彩色环境反光。
【输出约束】同一个人物，不换脸、不换服装、不换发型，不增加其他人，不出现文字、水印、边框和分屏标签，人物全身完整显示，比例正常。`;

const SCENE_PROMPT = `【画面类型】场景资产设定图，同一个古风花园的四视角展示，无人物，无动物，无剪影。
【场景信息】古代中式私家花园，春日午后，月门、回廊、海棠花树、石径和荷花池。
【空间结构】画面分为四个区域：左上为花园正面远景，右上为回廊侧面视角，左下为荷花池反向视角，右下为整体俯视空间关系图。四个视角必须是同一座花园，月门、回廊、石径、花树和池塘位置保持一致。
【光影与色调】暖金色午后阳光，主光从右上方照入，树影落在石径上，整体为柔和暖绿色调。
【视觉风格】电影级古风写实场景设定图，建筑细节清楚，植物自然，空间通透。
【输出约束】不出现任何人物、人体、脸部、路人、动物或剪影；不出现文字、水印、边框和分屏标签；保持建筑结构、光源方向和空间关系连续。`;

const PROP_PROMPT = `【画面类型】道具资产设定图，一把古刀的多视角展示，干净中性背景。
【道具信息】古代侠客使用的窄刃古刀，刀身修长，刀柄缠深色皮革，护手为暗银云纹，刀鞘为墨色木质并带银色包边。
【四视角布局】画面分为四个区域：左上展示刀与刀鞘完整正面，右上展示刀身侧面与厚度，左下展示刀柄和护手背面结构，右下展示刀身纹路、护手云纹和皮革细节。四个视角必须是同一把刀，尺寸、材质和磨损状态一致。
【材质细节】刀身冷银色带细密锻纹，刀刃有轻微使用痕迹，暗银护手有岁月氧化感，刀鞘木质温润，银边有细微划痕。
【输出约束】只展示这把古刀，不出现人物、手、身体、脸部、动物和额外武器；不出现文字、水印、边框和标签；刀身结构完整，刀锋连续，材质稳定。`;

const VIDEO_PROMPT = `【格式】
15秒，古风电影级写实，竖屏9:16，视听一体，真实音画同步。

【视觉风格】
东方古风电影质感，春日花园，暖金色逆光与青绿色环境色交织，花瓣粒子与薄雾轻动，镜头运动稳定，动作清晰。

【世界与场景】
古代私家花园，月门、回廊、海棠花树和石径围绕中央空地。花园表面宁静，真实空间关系保持一致。

【角色与场景锚定】
@图片1 = 古风美女，浅青色广袖长裙、银色花簪、黑色半束长发；全片保持脸型、服装、发饰和体型一致。
@图片2 = 古代花园场景参考，保持月门、回廊、花树、石径和光照方向一致。
@图片3 = 窄刃古刀，保持刀身、刀鞘、护手和磨损状态一致。
@音频1 = 清冷女声参考，保持音色、语速和情绪稳定。

【时间轴】
【镜号1】1-3秒
画面：花园远景缓慢推近，古风女子沿石径走入画面，衣袖被春风轻轻扬起，她停下脚步，视线扫向回廊暗处。
同步音效：鸟鸣、风穿花叶、远处水声。
对白：女子（压低声音、警觉）：“这里太安静了。”

【镜号2】3-6秒
画面：中近景侧移，她右手握住腰间刀柄，目光锁定回廊阴影，花瓣从镜头前景掠过。
同步音效：衣料摩擦、刀鞘轻碰、风声变紧。
对白：女子（冷静）：“既然来了，就别躲着。”

【镜号3】6-9秒
画面：近景快速推近到女子眼神，她瞬间拔刀，冷色刀光划过画面，木栏后出现一道快速退后的黑影。
同步音效：拔刀清鸣、脚步急退、木栏震动。
环境音：保持花园底噪。

【镜号4】9-12秒
画面：低角度环绕半周，女子横刀挡在身前，刀锋与飞来暗器碰撞，火花与花瓣同时炸开，衣摆随动作旋转。
同步音效：金属碰撞、暗器破风、花瓣被气浪卷起。
对白：女子（短促有力）：“只会偷袭吗？”

【镜号5】12-15秒
画面：镜头从刀锋缓慢上摇到女子侧脸，她收刀入鞘，抬眼望向月门深处，光影保持金蓝交错，最后一个动作定格半秒。
同步音效：刀入鞘轻响、风声恢复、远处传来第二声鸟鸣。
对白：女子（平静）：“出来吧，我等你。”

【声音】
配乐：低沉古琴与轻鼓，6秒后加入弦乐。
环境音：春日风声、鸟鸣、水声。
动作音：拔刀、暗器、金属碰撞、刀入鞘。
角色声线：女子为清冷克制的年轻女声，对白按时间轴与画面动作严格对齐口型。

【连续性与输出约束】
保持 @图片1 的人物外观、服装、发型和武器连续。
保持 @图片2 的月门、回廊、石径、花树和光线方向连续。
保持 @图片3 的刀身与刀鞘结构连续。
每个时间段只突出一个主要动作，动作由准备、释放、结果组成。
镜头切换清楚，运动平稳，画面无任何字幕。`;

const AUDIO_PROMPT = `请生成一段5秒左右的参考音频。内容：“这里太安静了。既然来了，就别躲着。”要求清冷、克制、清晰的年轻女声，语速平稳，情绪由警觉转为坚定，用于视频节点中的角色音色参考。`;

const GUIDE_TEXT = `模板使用说明
1. 三个参考图片已经内置，可直接使用；也可以修改提示词后生成替换图。
2. 示例参考音频已经内置，可播放试听；也可以连接自己的音频节点替换它。
3. 修改视频节点中的台词、时间轴和参考描述。
4. 检查人物、场景、道具和音频是否已连接到视频节点。
5. 最后在视频节点中手动点击生成。

模板只填充提示词和连线，不会自动提交图片或视频任务。`;

export function buildCanvasTemplate(templateId: CanvasTemplateId, center: Position, config: AiConfig) {
    if (templateId === "character-image") return imageTemplateResult("character-image", "人物资产图 · 古风美女", CHARACTER_PROMPT, center, config);
    if (templateId === "scene-image") return imageTemplateResult("scene-image", "场景资产图 · 古风花园", SCENE_PROMPT, center, config);
    if (templateId === "prop-image") return imageTemplateResult("prop-image", "道具资产图 · 古刀", PROP_PROMPT, center, config);
    return buildVideoFlowTemplate(center, config);
}

function imageTemplateResult(templateId: CanvasTemplateId, title: string, prompt: string, center: Position, config: AiConfig) {
    const width = NODE_DEFAULT_SIZE[CanvasNodeType.Image].width;
    const height = NODE_DEFAULT_SIZE[CanvasNodeType.Image].height;
    const node: CanvasNodeData = {
        id: `${templateId}-${nanoid()}`,
        type: CanvasNodeType.Image,
        title,
        position: { x: center.x - width / 2, y: center.y - height / 2 },
        width,
        height,
        metadata: imageMetadata(prompt, config, templateId, templateId.replace("-image", "")),
    };
    return { nodes: [node], connections: [] as CanvasConnection[], selectedNodeIds: [node.id] };
}

function buildVideoFlowTemplate(center: Position, config: AiConfig) {
    const groupWidth = 1540;
    const groupHeight = 680;
    const left = center.x - groupWidth / 2;
    const top = center.y - groupHeight / 2;
    const groupId = `template-video-group-${nanoid()}`;
    const guide: CanvasNodeData = {
        id: `template-guide-${nanoid()}`,
        type: CanvasNodeType.Text,
        title: "模板使用说明",
        position: { x: left + 30, y: top + 40 },
        width: 260,
        height: 300,
        metadata: { content: GUIDE_TEXT, status: "success", fontSize: 13, groupId, templateId: "video-flow", templateNodeRole: "guide" },
    };
    const character = imageNode("template-character", "人物参考图 · 古风美女", CHARACTER_PROMPT, left + 330, top + 40, config, groupId, "character", { url: templateAssetUrl("character-guofeng-woman.png"), width: 1672, height: 940, bytes: 1792432 });
    const scene = imageNode("template-scene", "场景参考图 · 古风花园", SCENE_PROMPT, left + 710, top + 40, config, groupId, "scene", { url: templateAssetUrl("scene-guofeng-garden.png"), width: 1672, height: 940, bytes: 3236186 });
    const prop = imageNode("template-prop", "道具参考图 · 古刀", PROP_PROMPT, left + 1090, top + 40, config, groupId, "prop", { url: templateAssetUrl("prop-ancient-knife.png"), width: 1672, height: 941, bytes: 1715635 });
    const audio: CanvasNodeData = {
        id: `template-audio-${nanoid()}`,
        type: CanvasNodeType.Audio,
        title: "示例参考音频 · 点击生成",
        position: { x: left + 330, y: top + 340 },
        width: 340,
        height: 120,
        metadata: {
            prompt: AUDIO_PROMPT,
            content: templateAssetUrl("reference-audio.wav"),
            status: "success",
            generationMode: "audio",
            sourceType: "upload",
            mimeType: "audio/wav",
            bytes: 814124,
            durationMs: 8480,
            model: config.audioModel,
            audioVoice: config.audioVoice,
            audioVoiceName: config.audioVoiceName,
            audioFormat: config.audioFormat,
            audioSpeed: config.audioSpeed,
            audioInstructions: config.audioInstructions,
            groupId,
            templateId: "video-flow",
            templateNodeRole: "audio",
        },
    };
    const video: CanvasNodeData = {
        id: `template-video-${nanoid()}`,
        type: CanvasNodeType.Video,
        title: "15秒视频示例 · 花园拔刀",
        position: { x: left + 760, y: top + 310 },
        width: 420,
        height: 236,
        metadata: {
            prompt: VIDEO_PROMPT,
            composerContent: VIDEO_PROMPT,
            status: "idle",
            generationMode: "video",
            model: config.videoModel,
            size: config.size,
            seconds: "15",
            vquality: config.vquality,
            generateAudio: config.videoGenerateAudio,
            watermark: config.videoWatermark,
            videoMode: config.videoMode,
            videoParameters: config.videoParameters,
            groupId,
            templateId: "video-flow",
            templateNodeRole: "video",
            references: [character.id, scene.id, prop.id, audio.id],
            referenceOrder: [character.id, scene.id, prop.id, audio.id],
        },
    };
    const group: CanvasNodeData = {
        id: groupId,
        type: CanvasNodeType.Group,
        title: "视频模板 · 15秒完整示例",
        position: { x: left, y: top },
        width: groupWidth,
        height: groupHeight,
        metadata: { status: "idle", groupColor: "#7c3aed", templateId: "video-flow", templateNodeRole: "group" },
    };
    const nodes = [group, guide, character, scene, prop, audio, video];
    const connections = [character, scene, prop, audio].map((source) => ({ id: nanoid(), fromNodeId: source.id, toNodeId: video.id }));
    return { nodes, connections, selectedNodeIds: [video.id] };
}

function imageNode(idPrefix: string, title: string, prompt: string, x: number, y: number, config: AiConfig, groupId: string, role: "character" | "scene" | "prop", asset: { url: string; width: number; height: number; bytes: number }): CanvasNodeData {
    return {
        id: `${idPrefix}-${nanoid()}`,
        type: CanvasNodeType.Image,
        title,
        position: { x, y },
        width: NODE_DEFAULT_SIZE[CanvasNodeType.Image].width,
        height: NODE_DEFAULT_SIZE[CanvasNodeType.Image].height,
        metadata: { ...imageMetadata(prompt, config, "video-flow", role), groupId, content: asset.url, status: "success", mimeType: "image/png", naturalWidth: asset.width, naturalHeight: asset.height, bytes: asset.bytes },
    };
}

function imageMetadata(prompt: string, config: AiConfig, templateId: CanvasTemplateId, templateNodeRole: string) {
    return { prompt, status: "idle" as const, generationMode: "image" as const, model: config.imageModel, size: config.size, quality: config.quality, templateId, templateNodeRole, templateEditable: true };
}

function templateAssetUrl(fileName: string) {
    return `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}templates/${fileName}`;
}
