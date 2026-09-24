import React, { useRef, useState } from 'react';
import type { CharacterImageGenerationProfile } from '../../types';
import { processImageToBlob } from '../../utils/file';
import { putImageBlob } from '../../utils/blobRef';
import TokenImg from '../os/TokenImg';

interface Props {
  value?: CharacterImageGenerationProfile;
  onChange: (value: CharacterImageGenerationProfile) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ImageGenerationPanel: React.FC<Props> = ({ value, onChange, addToast }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const profile: CharacterImageGenerationProfile = {
    appearancePrompt: '', referenceImages: [], faceLockStrength: 75,
    allowChat: true, allowSocial: true, ...(value || {}),
  };
  const patch = (updates: Partial<CharacterImageGenerationProfile>) => onChange({ ...profile, ...updates });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const remaining = Math.max(0, 4 - (profile.referenceImages?.length || 0));
    if (remaining === 0) return addToast('每个角色最多保存 4 张参考图', 'info');
    setUploading(true);
    try {
      const refs: string[] = [];
      for (const file of Array.from(files).slice(0, remaining)) {
        const blob = await processImageToBlob(file, { maxWidth: 1600, quality: 0.9 });
        refs.push(await putImageBlob(blob));
      }
      patch({ referenceImages: [...(profile.referenceImages || []), ...refs] });
      addToast(`已添加 ${refs.length} 张角色参考图`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '参考图上传失败', 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="bg-white rounded-3xl p-4 shadow-sm border border-violet-100 space-y-4">
      <div>
        <label className="text-[10px] font-bold text-violet-500 uppercase tracking-widest block">角色生图形象</label>
        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">这里固定角色本人；每次情境、姿势和环境由角色在聊天或 Spark 中临时决定。</p>
      </div>

      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">角色外貌提示词 / 生图串
        <textarea
          value={profile.appearancePrompt || ''}
          onChange={event => patch({ appearancePrompt: event.target.value })}
          className="w-full h-28 mt-1.5 bg-violet-50/40 rounded-2xl p-3 text-sm text-slate-700 resize-y outline-none focus:ring-1 focus:ring-violet-200"
          placeholder="发色、瞳色、脸型、身材、常用服装、画风等固定特征…"
        />
      </label>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">锁脸参考图（最多 4 张）</p>
            <p className="text-[10px] text-slate-400 mt-0.5">建议上传清晰正脸、侧脸或不同光线照片。</p>
          </div>
          <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="px-3 py-2 rounded-xl bg-violet-100 text-violet-700 text-xs font-bold disabled:opacity-50">
            {uploading ? '处理中…' : '＋上传'}
          </button>
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={event => void upload(event.target.files)} />
        </div>
        {!!profile.referenceImages?.length && (
          <div className="grid grid-cols-4 gap-2">
            {profile.referenceImages.map((ref, index) => (
              <div key={`${ref}-${index}`} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group">
                <TokenImg value={ref} className="w-full h-full object-cover" alt={`参考图 ${index + 1}`} />
                <button type="button" onClick={() => patch({ referenceImages: profile.referenceImages?.filter((_, i) => i !== index) })} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white text-xs">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="block text-[10px] font-bold text-slate-400">锁脸强度：{profile.faceLockStrength || 0}%
        <input type="range" min={0} max={100} value={profile.faceLockStrength || 0} onChange={event => patch({ faceLockStrength: Number(event.target.value) })} className="w-full mt-2 accent-violet-500" />
        <span className="font-normal leading-relaxed block mt-1">0% 不发送参考图；更高强度会强化身份保持。兼容模型不支持连续数值时，系统会映射为低/高保真并同时强化提示词。</span>
      </label>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <label className="flex items-center gap-2"><input type="checkbox" checked={profile.allowChat !== false} onChange={event => patch({ allowChat: event.target.checked })} />允许聊天主动生图</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={profile.allowSocial !== false} onChange={event => patch({ allowSocial: event.target.checked })} />允许 Spark 动态配图</label>
      </div>
    </div>
  );
};

export default ImageGenerationPanel;
