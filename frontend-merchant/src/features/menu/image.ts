/** Shrink a menu photo to MAX_PHOTO_PX before upload (bandwidth + R2 cost). */
import { MAX_PHOTO_PX } from './types';

export interface ShrunkPhoto {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
}

const JPEG = 'image/jpeg';

/** Decode, scale to fit MAX_PHOTO_PX, re-encode. Never upscales. */
export async function shrinkPhoto(params: { file: File }): Promise<ShrunkPhoto> {
  const bitmap = await createImageBitmap(params.file);
  const { width, height } = fitInside({ w: bitmap.width, h: bitmap.height });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('canvas 2d unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvasToBlob({ canvas });
  return { blob, contentType: JPEG, width, height };
}

/** Scale w/h to fit the cap, keeping aspect; never enlarges. */
export function fitInside(params: { w: number; h: number }): { width: number; height: number } {
  const scale = Math.min(1, MAX_PHOTO_PX / Math.max(params.w, params.h));
  return { width: Math.max(1, Math.round(params.w * scale)), height: Math.max(1, Math.round(params.h * scale)) };
}

function canvasToBlob(params: { canvas: HTMLCanvasElement }): Promise<Blob> {
  return new Promise((resolve, reject) => {
    params.canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('photo encode failed'));
    }, JPEG, 0.82);
  });
}
