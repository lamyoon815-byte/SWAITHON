import { Skia, type DataSourceParam } from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';

/** Resolve bundled previews to a device file before giving them to Skia. */
export async function loadCanvasImage(source: DataSourceParam) {
  if (source == null) return null;
  let value = typeof source === 'object' && 'default' in source ? source.default : source;
  if (typeof value === 'number') {
    const asset = await Asset.fromModule(value).downloadAsync();
    value = asset.localUri ?? asset.uri;
  }
  const data = value instanceof Uint8Array
    ? Skia.Data.fromBytes(value)
    : await Skia.Data.fromURI(typeof value === 'string' ? value : value.uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('Image decoding failed');
  return image;
}
