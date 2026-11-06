export function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw Error('Enter a server address such as http://192.168.1.20:4000.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('Use only a server origin, without credentials, query, or path.');
  const host = url.hostname.toLowerCase();
  const parts = host.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  const privateHost =
    host === 'localhost' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    (ipv4 &&
      (parts[0] === 10 ||
        parts[0] === 127 ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)));
  if (url.protocol === 'http:' && !privateHost)
    throw Error('Public servers require HTTPS. HTTP is limited to a trusted local network.');
  return url.origin;
}

export function resolveApiOrigin({
  configured,
  development,
  hostUri,
  webOrigin,
}: {
  configured?: string;
  development: boolean;
  hostUri?: string | null;
  webOrigin?: string | null;
}): string {
  if (configured?.trim()) return normalizeServerUrl(configured);
  if (!development) return '';
  const source = hostUri || (webOrigin ? new URL(webOrigin).host : '');
  if (!source) return '';
  try {
    const host = new URL(source.includes('://') ? source : 'http://' + source).hostname;
    return normalizeServerUrl(`http://${host}:4000`);
  } catch {
    return '';
  }
}
export function permitHttp({
  development,
  expoGo,
  web,
  localBuild,
}: {
  development: boolean;
  expoGo: boolean;
  web: boolean;
  localBuild: boolean;
}) {
  return localBuild || (development && (expoGo || web));
}
