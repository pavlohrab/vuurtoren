/** Cover images in the browser: crop to 4:5, downscale to 600x750 and encode as WebP. */

export const COVER_W = 600;
export const COVER_H = 750;

/** A crop of the source image, in source pixels, with a 4:5 aspect ratio. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The 4:5 crop for a pan/zoom position. `zoom` 1 = the largest 4:5 frame that fits; `panX` /
 * `panY` in [0, 1] place it (0.5 = centred).
 */
export function cropFor(
  width: number,
  height: number,
  zoom: number,
  panX: number,
  panY: number,
): CropRect {
  const z = Math.max(1, zoom);
  const baseW = Math.min(width, (height * 4) / 5);
  const w = baseW / z;
  const h = (w * 5) / 4;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x: (width - w) * clamp(panX),
    y: (height - h) * clamp(panY),
    w,
    h,
  };
}

/** Draw `crop` of `image` into a 600x750 canvas and encode it (WebP, else JPEG). */
export async function renderCover(image: CanvasImageSource, crop: CropRect): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, COVER_W, COVER_H);
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("The image could not be encoded.");
  return jpeg;
}

/** Load a picked file as an image element (rejects for files the browser cannot decode). */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file could not be opened as an image."));
    };
    img.src = url;
  });
}
