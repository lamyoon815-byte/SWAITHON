/** New MoMi links and previously printed artwork QR codes share the same catalog IDs. */
const PREFIXES = ['momi://artwork/', 'swaithon://artwork/'];

export function parseArtworkQr(data: string) {
  const text = data.trim();
  const prefix = PREFIXES.find((value) => text.startsWith(value));
  const id = prefix ? text.slice(prefix.length) : text;
  return id.length > 0 && id.length <= 64 ? id : null;
}
