// Loading a screenshot the user added for Claude (decisions 05): downloaded from the private
// recipe-images bucket by the caller (the build-draft function, as the service role; tests, the
// same), checked to be a JPEG of a size Claude takes, and turned into base64. Runtime-neutral.

import type { Screenshot } from './claude-extractor.ts';

/** The bucket's own limit (the 05 migration); the phone sends far less, at most 1568 px a side. */
export const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;

const isJpeg = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** How long a failed download waits before its one more try. */
const DOWNLOAD_RETRY_MS = 500;

/**
 * `loadScreenshot` for the Draft builder, over `download` (the bytes stored at a path). A download
 * that fails is tried once more, half a second later: Storage fails a read of an image while it's
 * being replaced (the phone sending a save again as the build starts). Something that isn't a
 * JPEG, or is too big, is refused rather than sent to Claude as one.
 */
export function screenshotLoader(
  download: (path: string, signal: AbortSignal) => Promise<ArrayBuffer>,
): (path: string, signal: AbortSignal) => Promise<Screenshot> {
  const downloadTwice = async (path: string, signal: AbortSignal) => {
    try {
      return await download(path, signal);
    } catch {
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_RETRY_MS));
      signal.throwIfAborted();
      return download(path, signal);
    }
  };
  return async (path, signal) => {
    const bytes = new Uint8Array(await downloadTwice(path, signal));
    if (bytes.length > MAX_SCREENSHOT_BYTES) throw new Error(`The screenshot at ${path} is ${bytes.length} bytes.`);
    if (!isJpeg(bytes)) throw new Error(`The screenshot at ${path} isn't a JPEG.`);
    return { mediaType: 'image/jpeg', base64: toBase64(bytes) };
  };
}
