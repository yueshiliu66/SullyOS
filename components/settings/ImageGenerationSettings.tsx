import React, { useEffect, useState } from 'react';
import type { APIConfig, ImageGenerationConfig } from '../../types';
import { extractModelIds } from '../../utils/modelList';
import { imageApiUrl, withImageGenerationDefaults } from '../../utils/imageGeneration';

interface Props {
  apiConfig: APIConfig;
  updateApiConfig: (updates: Partial<APIConfig>) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const fieldClass = 'w-full bg-white/60 border border-slate-200/70 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-violet-300';

const ImageGenerationSettings: React.FC<Props> = ({ apiConfig, updateApiConfig, addToast }) => {
  const [draft, setDraft] = useState<ImageGenerationConfig>(() => withImageGenerationDefaults(apiConfig.imageGeneration));
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => setDraft(withImageGenerationDefaults(apiConfig.imageGeneration)), [apiConfig.imageGeneration]);
  const patch = <K extends keyof ImageGenerationConfig>(key: K, value: ImageGenerationConfig[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  const pullModels = async () => {
    if (!draft.baseUrl || !draft.apiKey) return addToast('请先填写生图基址和 API Key', 'info');
    setLoadingModels(true);
    try {
      const response = await fetch(imageApiUrl(draft.baseUrl, 'models'), {
        headers: { Authorization: `Bearer ${draft.apiKey}` },
      });
      const raw = await response.text();
      let data: unknown;
      try { data = JSON.parse(raw); } catch { data = null; }
      if (!response.ok) throw new Error((data as any)?.error?.message || raw.slice(0, 200) || `HTTP ${response.status}`);
      const ids = extractModelIds(data).filter(id => /image|dall|flux/i.test(id));
      const allIds = ids.length > 0 ? ids : extractModelIds(data);
      setModels(allIds);
      if (!draft.model && allIds[0]) patch('model', allIds[0]);
      addToast(allIds.length ? `已拉取 ${allIds.length} 个可选模型` : '接口返回中没有识别到模型', allIds.length ? 'success' : 'info');
    } catch (error) {
      addToast(`拉取模型失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setLoadingModels(false);
    }
  };

  const save = () => {
    updateApiConfig({ imageGeneration: withImageGenerationDefaults(draft) });
    addToast('生图设置已保存', 'success');
  };

  return (
    <div className="rounded-2xl border border-violet-200/70 bg-violet-50/40 p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-700">🎨 GPT Image 生图</div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">支持 OpenAI Images 协议：无参考图走 generations，有参考图走 edits。</p>
        </div>
        <button type="button" onClick={() => patch('enabled', !draft.enabled)} className={`w-11 h-6 rounded-full p-0.5 transition-colors ${draft.enabled ? 'bg-violet-500' : 'bg-slate-300'}`}>
          <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${draft.enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">API 基址
          <input className={`${fieldClass} mt-1`} value={draft.baseUrl} onChange={e => patch('baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" />
        </label>
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">API Key
          <input type="password" className={`${fieldClass} mt-1`} value={draft.apiKey} onChange={e => patch('apiKey', e.target.value)} placeholder="sk-..." autoComplete="off" />
        </label>
        <div>
          <div className="flex items-end gap-2">
            <label className="flex-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">模型
              <input className={`${fieldClass} mt-1`} list="image-generation-models" value={draft.model} onChange={e => patch('model', e.target.value)} placeholder="gpt-image-1" />
            </label>
            <button type="button" onClick={pullModels} disabled={loadingModels} className="shrink-0 px-3 py-2 rounded-xl bg-violet-100 text-violet-700 text-xs font-bold disabled:opacity-50">
              {loadingModels ? '拉取中…' : '拉取模型'}
            </button>
          </div>
          <datalist id="image-generation-models">{models.map(model => <option key={model} value={model} />)}</datalist>
        </div>
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">全局生图提示词
          <textarea className={`${fieldClass} mt-1 min-h-20 resize-y`} value={draft.globalPrompt} onChange={e => patch('globalPrompt', e.target.value)} placeholder="例如：电影感写实摄影，自然肤质，细节丰富…" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] font-bold text-slate-400">尺寸
          <select className={`${fieldClass} mt-1`} value={draft.size} onChange={e => patch('size', e.target.value as ImageGenerationConfig['size'])}>
            <option value="auto">自动</option><option value="1024x1024">1024×1024</option><option value="1024x1536">竖图</option><option value="1536x1024">横图</option>
          </select>
        </label>
        <label className="text-[10px] font-bold text-slate-400">质量
          <select className={`${fieldClass} mt-1`} value={draft.quality} onChange={e => patch('quality', e.target.value as ImageGenerationConfig['quality'])}>
            <option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.autoChat} onChange={e => patch('autoChat', e.target.checked)} />聊天主动生图</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.autoSocial} onChange={e => patch('autoSocial', e.target.checked)} />Spark 动态配图</label>
      </div>
      <label className="block text-[10px] font-bold text-slate-400">聊天生图冷却：至少间隔 {draft.cooldownMessages} 条消息
        <input type="range" min={0} max={30} value={draft.cooldownMessages} onChange={e => patch('cooldownMessages', Number(e.target.value))} className="w-full accent-violet-500 mt-1" />
      </label>

      <button type="button" onClick={save} className="w-full py-2.5 rounded-xl bg-violet-500 text-white text-sm font-bold active:scale-[0.99] transition-transform">保存生图设置</button>
      <p className="text-[10px] text-slate-400 leading-relaxed">Key 仅保存在本机配置中。第三方兼容站必须同时实现 <code>/models</code>、<code>/images/generations</code>，使用参考图时还需实现 <code>/images/edits</code>。</p>
    </div>
  );
};

export default ImageGenerationSettings;
