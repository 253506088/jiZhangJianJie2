import { backgroundMime, MAX_BACKGROUND_BYTES, type HomeBackground } from '../core/home-background';

/** Keep original bytes so GIF/WebP frames survive selection, restart and backup. */
export async function readHomeBackground(file: File): Promise<HomeBackground> {
  if (!file.size || file.size > MAX_BACKGROUND_BYTES)
    throw new Error('请选择不超过 8 MiB 的图片。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = backgroundMime(bytes);
  if (!mime) throw new Error('支持 JPG、PNG、GIF 和 WebP 图片。');
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24_576)
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
  const dataUrl = `data:${mime};base64,${chunks.join('')}`;
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.src = '';
      reject(new Error('图片读取超时，请换一张图片。'));
    }, 15_000);
    image.onload = () => {
      clearTimeout(timer);
      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth > 8192 ||
        image.naturalHeight > 8192 ||
        image.naturalWidth * image.naturalHeight > 32_000_000
      )
        reject(new Error('图片尺寸过大，请选择长宽不超过 8192 像素且不超过 3200 万像素的图片。'));
      else resolve();
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error('图片无法解码，请重新选择原始图片。'));
    };
    image.src = dataUrl;
  });
  return { dataUrl, fit: 'cover' };
}
