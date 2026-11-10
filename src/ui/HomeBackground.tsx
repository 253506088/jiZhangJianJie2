import { useState } from 'react';
import { updateSettings } from '../core';
import type { HomeBackground as Background } from '../core/home-background';
import type { PageProps } from './contracts';
import { readHomeBackground } from './home-background-file';
import './home-background.css';

export function HomeBackground({ value }: { value?: Background | null }) {
  return value ? (
    <img
      className="lj-home-background"
      src={value.dataUrl}
      style={{ objectFit: value.fit }}
      alt=""
      aria-hidden="true"
    />
  ) : null;
}

export function HomeBackgroundSettings({
  state,
  busy,
  commit,
}: Pick<PageProps, 'state' | 'busy' | 'commit'>) {
  const [draft, setDraft] = useState<Background | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const saved = state.settings.homeBackground;
  const preview = draft ?? saved;
  const disabled = busy || reading;
  return (
    <section className="lj-background-settings" aria-label="首页背景设置">
      <h3 className="lj-palette-heading">首页背景</h3>
      <p className="lj-help">
        支持 JPG、PNG、GIF 和 WebP（含动图），最大 8 MiB。图片保存在本机，并随完整备份保留。
      </p>
      {preview && (
        <div className="lj-background-preview">
          <HomeBackground value={preview} />
          <span>首页背景预览</span>
        </div>
      )}
      <label className="lj-background-file">
        {reading ? '正在读取图片…' : '选择静态图或动图'}
        <input
          aria-label="选择首页背景图片"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
          disabled={disabled}
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setReading(true);
            setError('');
            try {
              setDraft(await readHomeBackground(file));
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '图片读取失败');
            } finally {
              setReading(false);
            }
          }}
        />
      </label>
      {preview && (
        <label className="lj-background-fit">
          显示方式
          <select
            aria-label="背景显示方式"
            disabled={disabled}
            value={preview.fit}
            onChange={(event) =>
              setDraft({ ...preview, fit: event.currentTarget.value as Background['fit'] })
            }
          >
            <option value="cover">铺满（可能裁剪）</option>
            <option value="contain">完整显示</option>
          </select>
        </label>
      )}
      <div className="lj-background-actions">
        {draft && (
          <>
            <button
              className="lj-primary"
              disabled={disabled}
              onClick={async () => {
                if (
                  await commit(
                    (current) => updateSettings(current, { homeBackground: draft }),
                    '首页背景已保存',
                  )
                )
                  setDraft(null);
              }}
            >
              应用首页背景
            </button>
            <button disabled={disabled} onClick={() => setDraft(null)}>
              取消预览
            </button>
          </>
        )}
        {saved && (
          <button
            disabled={disabled}
            onClick={async () => {
              if (
                await commit(
                  (current) => updateSettings(current, { homeBackground: null }),
                  '已恢复默认首页背景',
                )
              )
                setDraft(null);
            }}
          >
            恢复默认背景
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="lj-error">
          {error}
        </p>
      )}
    </section>
  );
}
