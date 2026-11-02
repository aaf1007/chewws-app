import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** A picture ready to send (a screenshot, or a Cook Log photo): shown from `uri`, uploaded as `jpeg`. */
export type PreparedImage = { uri: string; jpeg: ArrayBuffer };

/** Claude reads images up to this many pixels on the long edge; bigger ones cost more for nothing. */
const LONG_EDGE = 1568;

function toArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * A picture on the phone as the app uploads the user's own images (decisions 05, and Cook Log
 * photos, decisions 16): scaled down to at most 1568 px on its long edge, as a JPEG at quality 0.8.
 */
export async function prepareImage(uri: string): Promise<PreparedImage> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const longEdge = Math.max(original.width, original.height);
  const image =
    longEdge > LONG_EDGE
      ? await ImageManipulator.manipulate(uri)
          .resize(original.width >= original.height ? { width: LONG_EDGE } : { height: LONG_EDGE })
          .renderAsync()
      : original;
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) throw new Error('The picture could not be read.');
  return { uri: saved.uri, jpeg: toArrayBuffer(saved.base64) };
}

/**
 * Lets the user pick a picture from their photo library (no camera), and prepares it. Null when
 * they cancel. The system picker needs no photo permission.
 */
export async function pickImage(): Promise<PreparedImage | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = picked.canceled ? undefined : picked.assets[0];
  return asset ? prepareImage(asset.uri) : null;
}
