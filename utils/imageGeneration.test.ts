import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, ImageGenerationConfig, Message } from '../types';
import {
  buildChatImageGenerationInstruction,
  buildImagePrompt,
  canAutoGenerateInChat,
  extractImageGenerationRequest,
  generateImageToBlobRef,
  imageApiRoot,
  imageApiUrl,
} from './imageGeneration';
import { dataUrlToBlob, getBlobForRef, putImageBlob } from './blobRef';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const config: ImageGenerationConfig = {
  enabled: true,
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'sk-test',
  model: 'gpt-image-1',
  globalPrompt: '电影感写实摄影',
  size: '1024x1024',
  quality: 'high',
  autoChat: true,
  autoSocial: true,
  cooldownMessages: 3,
};

const char = {
  id: 'c1', name: 'Sully', avatar: '',
  imageGeneration: {
    appearancePrompt: '黑色长发，琥珀色眼睛',
    referenceImages: ['blobref:face'],
    faceLockStrength: 85,
  },
} as CharacterProfile;

describe('GPT Image generation helpers', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('接受根地址或完整 images 端点', () => {
    expect(imageApiRoot(' https://api.example.com/v1/images/generations/ ')).toBe('https://api.example.com/v1');
    expect(imageApiUrl(config.baseUrl, 'images/edits')).toBe('https://api.example.com/v1/images/edits');
  });

  it('组合全局、角色和场景提示词，并按锁脸强度补身份规则', () => {
    const prompt = buildImagePrompt(config, char, '雨夜街头回头看镜头');
    expect(prompt).toContain('电影感写实摄影');
    expect(prompt).toContain('黑色长发，琥珀色眼睛');
    expect(prompt).toContain('严格保持参考图中同一人物');
    expect(prompt).toContain('雨夜街头回头看镜头');
  });

  it('只消费第一个主动生图标签并从正文彻底剥离协议', () => {
    const result = extractImageGenerationRequest('看这里。\n[[GENERATE_IMAGE: 海边逆光半身照]]\n[[GENERATE_IMAGE: 不应执行]]');
    expect(result.scenePrompt).toBe('海边逆光半身照');
    expect(result.cleanedContent).toBe('看这里。');
  });

  it('按最近一张生成图片执行消息冷却', () => {
    const generated = { role: 'assistant', type: 'image', metadata: { generatedImage: true } } as Message;
    const ordinary = { role: 'user', type: 'text', metadata: {} } as Message;
    expect(canAutoGenerateInChat(config, char, [generated, ordinary, ordinary])).toBe(false);
    expect(canAutoGenerateInChat(config, char, [generated, ordinary, ordinary, ordinary])).toBe(true);
    expect(buildChatImageGenerationInstruction(config, char, [ordinary])).toContain('[[GENERATE_IMAGE:');
  });

  it('无可用参考图时调用 generations JSON 接口并保存返回图片', async () => {
    let requestUrl = '';
    let requestBody = '';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = String(init?.body || '');
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), { status: 200 });
    }));
    const generated = await generateImageToBlobRef(config, { ...char, imageGeneration: { ...char.imageGeneration, referenceImages: [] } }, '窗边自拍');
    expect(requestUrl).toBe('https://api.example.com/v1/images/generations');
    expect(JSON.parse(requestBody)).toMatchObject({ model: 'gpt-image-1', n: 1, quality: 'high' });
    expect((await getBlobForRef(generated.ref))?.type).toBe('image/png');
  });

  it('有参考图时调用 edits multipart 接口并映射高锁脸强度', async () => {
    const reference = await putImageBlob(dataUrlToBlob(`data:image/png;base64,${TINY_PNG_B64}`));
    let requestUrl = '';
    let form: FormData | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      form = init?.body as FormData;
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), { status: 200 });
    }));
    await generateImageToBlobRef(config, {
      ...char,
      imageGeneration: { ...char.imageGeneration, referenceImages: [reference], faceLockStrength: 90 },
    }, '咖啡店侧脸');
    expect(requestUrl).toBe('https://api.example.com/v1/images/edits');
    expect(form?.get('input_fidelity')).toBe('high');
    expect(form?.getAll('image[]')).toHaveLength(1);
  });
});
