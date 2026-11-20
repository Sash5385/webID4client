// Просмотрщик артефактов блокирует fetch() для data:-адресов (connect-src), а модели вшиты как data-URL.
// Перехватываем такие запросы и отдаём байты сами, не обращаясь к сети.
const origFetch = window.fetch.bind(window);

function decodeDataUrl(url: string): { bytes: Uint8Array; type: string } {
  const comma = url.indexOf(',');
  const meta = url.slice(5, comma);
  const type = meta.split(';')[0] || 'application/octet-stream';
  const body = url.slice(comma + 1);
  if (meta.includes(';base64')) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, type };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(body)), type };
}

window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('data:')) {
    try {
      const { bytes, type } = decodeDataUrl(url);
      return Promise.resolve(new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'Content-Type': type } }));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return origFetch(input, init);
}) as typeof window.fetch;
