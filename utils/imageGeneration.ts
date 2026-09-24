import type {
  CharacterProfile,
  ImageGenerationConfig,
  Message,
} from '../types';
import { dataUrlToBlob, getBlobForRef, isBlobRef, putImageBlob } from './blobRef';

export const DEFAULT_IMAGE_GENERATION_CONFIG: ImageGenerationConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: 'gpt-image-1',
  globalPrompt: '',
  size: '1024x1024',
  quality: 'auto',
  autoChat: true,
  autoSocial: true,
  cooldownMessages: 6,
};

export function withImageGenerationDefaults(
  value?: Partial<ImageGenerationConfig> | null,
): ImageGenerationConfig {
  return {
    ...DEFAULT_IMAGE_GENERATION_CONFIG,
    ...(value || {}),
    cooldownMessages: Math.max(0, Math.min(100, Math.round(Number(value?.cooldownMessages ?? 6) || 0))),
  };
}

const clampStrength = (value: unknown): number =>
  Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

/** 用户可粘贴 API 根地址，也可误粘完整 images 端点；两者都收敛成根地址。 */
export function imageApiRoot(baseUrl: string): string {
  return String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/images\/(?:generations|edits)$/i, '');
}

export function imageApiUrl(baseUrl: string, path: 'models' | 'images/generations' | 'images/edits'): string {
  return `${imageApiRoot(baseUrl)}/${path}`;
}

export function buildImagePrompt(
  config: ImageGenerationConfig,
  char: CharacterProfile,
  scenePrompt: string,
): string {
  const profile = char.imageGeneration;
  const strength = clampStrength(profile?.faceLockStrength);
  const hasReferences = strength > 0 && (profile?.referenceImages?.length || 0) > 0;
  const identityRule = !hasReferences ? '' : strength >= 75
    ? '严格保持参考图中同一人物的身份特征、脸型、五官比例和辨识度，只改变场景、姿势、服装与光线。'
    : strength >= 40
      ? '保持参考图人物可辨识的核心面部特征，同时允许为适应画风和场景做适度调整。'
      : '参考人物的主要身份特征，但允许较明显的风格化变化。';

  return [
    config.globalPrompt?.trim(),
    profile?.appearancePrompt?.trim() ? `角色固定外貌：${profile.appearancePrompt.trim()}` : '',
    identityRule,
    `当前画面：${String(scenePrompt || '').trim()}`,
    '只生成一张完整画面，不要添加文字、水印、对话框或界面边框。',
  ].filter(Boolean).join('\n');
}

export function canAutoGenerateInChat(
  config: ImageGenerationConfig | undefined,
  char: CharacterProfile,
  history: Message[],
): boolean {
  const resolved = withImageGenerationDefaults(config);
  if (!resolved.enabled || !resolved.autoChat || char.imageGeneration?.allowChat === false) return false;
  if (!resolved.baseUrl || !resolved.apiKey || !resolved.model) return false;
  const lastGenerated = [...history].reverse().findIndex(message => message.metadata?.generatedImage === true);
  if (lastGenerated < 0) return true;
  return lastGenerated >= resolved.cooldownMessages;
}

export function buildChatImageGenerationInstruction(
  config: ImageGenerationConfig | undefined,
  char: CharacterProfile,
  history: Message[],
): string {
  if (!canAutoGenerateInChat(config, char, history)) return '';
  return `
[可选能力：主动发送情境图片]
只有当当前情境自然地值得用一张图片表达时，你可以在回复末尾输出一次：
[[GENERATE_IMAGE: 具体画面描述]]
画面描述应写清动作、服装、环境、光线、构图和镜头；不要重复角色固定外貌。不要解释这个标记，也不要为了展示能力而频繁使用。每次最多一个标记。`;
}

export function extractImageGenerationRequest(content: string): {
  cleanedContent: string;
  scenePrompt?: string;
} {
  let scenePrompt: string | undefined;
  const cleanedContent = String(content || '').replace(
    /\[\[GENERATE_IMAGE\s*:\s*([\s\S]*?)\]\]/gi,
    (_whole, prompt: string) => {
      if (!scenePrompt && prompt.trim()) scenePrompt = prompt.trim();
      return '';
    },
  ).replace(/\n{3,}/g, '\n\n').trim();
  return { cleanedContent, scenePrompt };
}

async function parseImageResponse(response: Response): Promise<Blob> {
  const raw = await response.text();
  let body: any;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = null; }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || raw.slice(0, 300) || `HTTP ${response.status}`;
    throw new Error(`生图接口请求失败（${response.status}）：${message}`);
  }
  const item = body?.data?.[0];
  if (typeof item?.b64_json === 'string' && item.b64_json) {
    return dataUrlToBlob(`data:image/png;base64,${item.b64_json}`);
  }
  if (typeof item?.url === 'string' && item.url) {
    const imageResponse = await fetch(item.url);
    if (!imageResponse.ok) throw new Error(`生成成功，但下载图片失败（${imageResponse.status}）`);
    return imageResponse.blob();
  }
  throw new Error('生图接口没有返回 data[0].b64_json 或 data[0].url');
}

function requestHeaders(config: ImageGenerationConfig): HeadersInit {
  return { Authorization: `Bearer ${config.apiKey}` };
}

function supportsInputFidelity(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'gpt-image-1' || normalized === 'gpt-image-1.5';
}

/** 调用 OpenAI Images generation/edit 协议并将结果直接存入本地 Blob 仓库。 */
export async function generateImageToBlobRef(
  rawConfig: ImageGenerationConfig,
  char: CharacterProfile,
  scenePrompt: string,
): Promise<{ ref: string; prompt: string }> {
  const config = withImageGenerationDefaults(rawConfig);
  if (!config.enabled) throw new Error('生图功能未开启');
  if (!config.baseUrl || !config.apiKey || !config.model) throw new Error('请先填写生图基址、API Key 和模型');
  const prompt = buildImagePrompt(config, char, scenePrompt);
  const strength = clampStrength(char.imageGeneration?.faceLockStrength);
  const referenceValues = strength > 0 ? (char.imageGeneration?.referenceImages || []).slice(0, 4) : [];
  const referenceBlobs = (await Promise.all(referenceValues.map(async value => {
    if (isBlobRef(value)) return getBlobForRef(value);
    if (value.startsWith('data:')) return dataUrlToBlob(value);
    if (/^https?:\/\//i.test(value)) {
      const response = await fetch(value);
      return response.ok ? response.blob() : null;
    }
    return null;
  }))).filter((blob): blob is Blob => blob instanceof Blob);

  let response: Response;
  if (referenceBlobs.length > 0) {
    const body = new FormData();
    body.append('model', config.model);
    body.append('prompt', prompt);
    body.append('size', config.size);
    body.append('quality', config.quality);
    body.append('n', '1');
    if (supportsInputFidelity(config.model)) {
      body.append('input_fidelity', strength >= 60 ? 'high' : 'low');
    }
    referenceBlobs.forEach((blob, index) => body.append('image[]', blob, `reference-${index + 1}.png`));
    response = await fetch(imageApiUrl(config.baseUrl, 'images/edits'), {
      method: 'POST', headers: requestHeaders(config), body,
    });
  } else {
    response = await fetch(imageApiUrl(config.baseUrl, 'images/generations'), {
      method: 'POST',
      headers: { ...requestHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt,
        size: config.size,
        quality: config.quality,
        n: 1,
      }),
    });
  }

  const blob = await parseImageResponse(response);
  return { ref: await putImageBlob(blob), prompt };
}

