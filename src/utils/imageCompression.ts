export interface CompressedImageResult {
  dataUrl: string;
  byteLength: number;
  width: number;
  height: number;
}

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_SOURCE_FILE_BYTES = 15 * 1024 * 1024; // 15 MB raw upload ceiling

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode the selected image file.'));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

export async function compressKycImageFile(
  file: File,
  options: {
    maxDimension: number;
    maxDataUrlChars: number;
    initialQuality?: number;
  },
): Promise<CompressedImageResult> {
  if (!file) {
    throw new Error('No image file selected.');
  }
  if (file.type && !ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase()) && !file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPG, PNG, or WebP).');
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error('Image file is too large (maximum 15 MB).');
  }

  const rawUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(rawUrl);

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width <= 0 || height <= 0) {
    throw new Error('Selected image has invalid dimensions.');
  }

  const scale = Math.min(1, options.maxDimension / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas support is required to process KYC photos.');
  }

  let currentWidth = width;
  let currentHeight = height;
  let quality = options.initialQuality ?? 0.78;
  let dataUrl = '';

  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = currentWidth;
    canvas.height = currentHeight;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, currentWidth, currentHeight);
    ctx.drawImage(img, 0, 0, currentWidth, currentHeight);

    dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= options.maxDataUrlChars) {
      return {
        dataUrl,
        byteLength: dataUrl.length,
        width: currentWidth,
        height: currentHeight,
      };
    }

    if (quality > 0.48) {
      quality = Math.max(0.42, quality - 0.12);
    } else {
      currentWidth = Math.max(160, Math.round(currentWidth * 0.8));
      currentHeight = Math.max(120, Math.round(currentHeight * 0.8));
    }
  }

  throw new Error('Image could not be compressed below the storage limit. Please try a clearer or cropped photo.');
}

export function formatApproxKb(charLength: number | undefined): string {
  if (!charLength) return '';
  const kb = Math.max(1, Math.round((charLength * 0.75) / 1024));
  return `${kb} KB`;
}
