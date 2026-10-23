export const MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
export const QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
const FORMATS = ['png', 'jpeg', 'webp'];

export class ImageError extends Error {
  constructor(code, message) { super(message); this.name = 'ImageError'; this.code = code; }
}
const invalid = message => { throw new ImageError('INVALID_ARGUMENT', message); };

export function generationURL(baseURL) {
  let url;
  try { url = new URL(baseURL); } catch { throw new ImageError('INVALID_ENDPOINT', 'Configure an absolute Images API base URL ending in /v1.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ImageError('INVALID_ENDPOINT', 'The API base URL must use HTTP(S), without credentials, query, or fragment.');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new ImageError('INVALID_ENDPOINT', 'Use HTTPS for a remote Images API.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/images/generations`;
  return url.href;
}

export function requestBody(args, config) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('Expected an object.');
  const allowed = ['prompt', 'model', 'n', 'size', 'quality', 'output_format', 'output_compression', 'background'];
  if (Object.keys(args).some(key => !allowed.includes(key))) invalid('Unknown image generation option.');
  if (typeof args.prompt !== 'string' || !args.prompt.trim() || [...args.prompt].length > 32000) invalid('prompt must contain 1–32000 characters.');
  const model = args.model ?? config.defaultModel ?? MODELS[0];
  if (!MODELS.includes(model)) invalid(`model must be ${MODELS.join(' or ')}.`);
  const n = args.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > (config.maxImages ?? 4)) invalid(`n must be between 1 and ${config.maxImages ?? 4}.`);
  const body = { model, prompt: args.prompt, n };
  if (args.size !== undefined) {
    if (args.size !== 'auto') {
      if (typeof args.size !== 'string' || !/^\d{2,4}x\d{2,4}$/.test(args.size)) invalid('size must be auto or WIDTHxHEIGHT.');
      const [w, h] = args.size.split('x').map(Number), pixels = w * h;
      if (w % 16 || h % 16 || w > 3840 || h > 3840 || w / h < 1 / 3 || w / h > 3 || pixels < 655360 || pixels > 8294400) {
        invalid('size requires multiples of 16, at most 3840 per side, aspect ratio 1:3–3:1, and 655360–8294400 pixels.');
      }
    }
    body.size = args.size;
  }
  for (const [key, values] of [['quality', QUALITIES], ['output_format', FORMATS], ['background', ['auto', 'opaque', 'transparent']]]) {
    if (args[key] !== undefined) {
      if (!values.includes(args[key])) invalid(`${key} must be one of ${values.join(', ')}.`);
      body[key] = args[key];
    }
  }
  if (args.background === 'transparent' && args.output_format === 'jpeg') invalid('Transparent backgrounds require png or webp.');
  if (args.output_compression !== undefined) {
    if (!['jpeg', 'webp'].includes(args.output_format)) invalid('output_compression requires output_format jpeg or webp.');
    if (!Number.isInteger(args.output_compression) || args.output_compression < 0 || args.output_compression > 100) invalid('output_compression must be between 0 and 100.');
    body.output_compression = args.output_compression;
  }
  return body;
}

// Bound decompressed response bytes too; Content-Length alone is insufficient.
export async function readLimited(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new ImageError('RESPONSE_TOO_LARGE', 'The image API response exceeds the configured byte limit.');
  }
  if (!response.body) throw new ImageError('EMPTY_RESPONSE', 'The image API returned an empty body.');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new ImageError('RESPONSE_TOO_LARGE', 'The image API response exceeds the configured byte limit.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

export function decodeImage(data) {
  if (typeof data !== 'string' || !data.length || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new ImageError('INVALID_IMAGE', 'Expected canonical base64 image data in data[].b64_json.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) throw new ImageError('INVALID_IMAGE', 'The image API returned invalid base64.');
  let mediaType, extension;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) [mediaType, extension] = ['image/png', 'png'];
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) [mediaType, extension] = ['image/jpeg', 'jpg'];
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') [mediaType, extension] = ['image/webp', 'webp'];
  else throw new ImageError('INVALID_IMAGE', 'The image API did not return PNG, JPEG, or WebP image bytes.');
  return { data: bytes, mediaType, extension };
}

function numericUsage(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return undefined;
  const entries = Object.entries(value).slice(0, 24).flatMap(([key, item]) => {
    if (!/^[a-z_]{1,64}$/.test(key)) return [];
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) return [[key, item]];
    const nested = numericUsage(item, depth + 1);
    return nested && Object.keys(nested).length ? [[key, nested]] : [];
  });
  return Object.fromEntries(entries);
}

export async function generateImages({ config, args, apiKey, signal, fetchImpl = globalThis.fetch }) {
  const body = requestBody(args, config), url = generationURL(config.baseURL);
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[^\x21-\x7e]/.test(apiKey)) {
    throw new ImageError('MISSING_CREDENTIAL', 'Configure a usable API key through the DSH credential store.');
  }
  const timeout = AbortSignal.timeout(config.timeoutMs ?? 180000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    combined.throwIfAborted();
    const response = await fetchImpl(url, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: combined,
    });
    const text = await readLimited(response, response.ok ? (config.maxResponseMiB ?? 128) * 1024 * 1024 : 64 * 1024);
    let payload;
    try { payload = JSON.parse(text); } catch {
      throw new ImageError('API_ERROR', `Images API returned HTTP ${response.status} with an invalid JSON body.`);
    }
    if (!response.ok || payload?.error) {
      const message = typeof payload?.error?.message === 'string' ? payload.error.message.replaceAll(apiKey, '[redacted]').replace(/[\r\n\t]/g, ' ').slice(0, 500) : 'Request rejected.';
      throw new ImageError('API_ERROR', `Images API HTTP ${response.status}: ${message}`);
    }
    if (!Array.isArray(payload?.data) || payload.data.length !== body.n) {
      throw new ImageError('INVALID_RESPONSE', `Expected ${body.n} image(s) in data[]. No automatic retry was made.`);
    }
    combined.throwIfAborted();
    const images = payload.data.map(item => decodeImage(item?.b64_json));
    return { model: body.model, images, ...(numericUsage(payload.usage) ? { usage: numericUsage(payload.usage) } : {}) };
  } catch (error) {
    if (signal?.aborted) throw new ImageError('CANCELLED', 'Image generation was cancelled; the provider may still charge for accepted work.');
    if (timeout.aborted) throw new ImageError('TIMEOUT', 'Image generation timed out; check the provider before retrying because accepted work may be charged.');
    if (error instanceof ImageError) throw error;
    throw new ImageError('TRANSPORT_ERROR', 'Unable to complete the Images API request. Check the endpoint, TLS, and DSH proxy settings before retrying; accepted work may be charged.');
  }
}
