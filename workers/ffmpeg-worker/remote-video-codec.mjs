import { fetchMedia } from "./media-fetch.mjs";

const WINDOW_BYTES = 64 * 1024;
const MAX_MOOV_BYTES = 2 * 1024 * 1024;
const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_TOP_LEVEL_ATOMS = 32;
const SUPPORTED_CODECS = new Map([["avc1", "h264"], ["avc3", "h264"], ["hvc1", "hevc"], ["hev1", "hevc"]]);

function preflightError(message, cause) {
  return Object.assign(new Error(`无法确认链接视频编码：${message}`, cause ? { cause } : undefined), {
    code: "VIDEO_CODEC_PREFLIGHT_FAILED", statusCode: 422,
  });
}

function atomHeader(buffer, offset, limit) {
  if (offset + 8 > limit) throw preflightError("MP4 元数据不完整");
  let size = buffer.readUInt32BE(offset);
  const type = buffer.toString("ascii", offset + 4, offset + 8);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > limit) throw preflightError("MP4 扩展元数据不完整");
    const extended = buffer.readBigUInt64BE(offset + 8);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw preflightError("MP4 元数据偏移超出范围");
    size = Number(extended);
    headerSize = 16;
  }
  if (size === 0) size = limit - offset;
  if (size < headerSize || offset + size > limit) throw preflightError("MP4 元数据长度无效");
  return { type, size, payload: offset + headerSize, end: offset + size };
}

function children(buffer, start, end) {
  const result = [];
  for (let offset = start; offset < end;) {
    const atom = atomHeader(buffer, offset, end);
    result.push(atom);
    offset = atom.end;
  }
  return result;
}

function declaredVideoCodecs(moov) {
  const outer = atomHeader(moov, 0, moov.length);
  const tags = [];
  for (const trak of children(moov, outer.payload, outer.end).filter(atom => atom.type === "trak")) {
    const mdia = children(moov, trak.payload, trak.end).find(atom => atom.type === "mdia");
    if (!mdia) continue;
    const mediaAtoms = children(moov, mdia.payload, mdia.end);
    const hdlr = mediaAtoms.find(atom => atom.type === "hdlr");
    if (!hdlr || hdlr.payload + 12 > hdlr.end || moov.toString("ascii", hdlr.payload + 8, hdlr.payload + 12) !== "vide") continue;
    const minf = mediaAtoms.find(atom => atom.type === "minf");
    const stbl = minf && children(moov, minf.payload, minf.end).find(atom => atom.type === "stbl");
    const stsd = stbl && children(moov, stbl.payload, stbl.end).find(atom => atom.type === "stsd");
    if (!stsd || stsd.payload + 8 > stsd.end) throw preflightError("视频流缺少编码元数据");
    const count = moov.readUInt32BE(stsd.payload + 4);
    if (count < 1 || count > 128) throw preflightError("视频流编码条目数量无效");
    const entries = children(moov, stsd.payload + 8, stsd.end);
    if (entries.length !== count) throw preflightError("视频流编码条目不完整");
    tags.push(...entries.map(entry => entry.type));
  }
  if (!tags.length) throw preflightError("未找到视频轨道");
  return tags;
}

function sanitizedHeaders(headers) {
  const result = {};
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    for (const [name, value] of Object.entries(headers)) {
      if (["referer", "origin", "user-agent"].includes(name.toLowerCase()) && typeof value === "string" && value.length <= 2048 && !/[\r\n]/.test(value)) result[name] = value;
    }
  }
  return result;
}

function readWithSignal(reader, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      signal.removeEventListener("abort", aborted);
      callback(value);
    };
    const aborted = () => finish(reject, signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    reader.read().then(value => finish(resolve, value), error => finish(reject, error));
  });
}

// Inspect only the MP4 metadata. In particular, jump over mdat rather than
// downloading candidate videos merely to discover that their codec is bvc2.
// Actual frame decoding still runs after the selected rendition is downloaded.
export async function probeRemoteVideoCodec(url, { headers, signal } = {}, fetchImpl = fetch) {
  let parsed;
  try { parsed = new URL(url); } catch { throw preflightError("视频地址无效"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw preflightError("视频地址协议不支持");
  const baseHeaders = sanitizedHeaders(headers);
  const cache = [];
  let totalLength;
  let bytesRead = 0;

  async function read(offset, length) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1) throw preflightError("MP4 元数据偏移无效");
    const cached = cache.find(item => item.offset <= offset && item.offset + item.buffer.length >= offset + length);
    if (cached) return cached.buffer.subarray(offset - cached.offset, offset - cached.offset + length);
    const available = totalLength === undefined ? Number.POSITIVE_INFINITY : totalLength - offset;
    const requestLength = Math.min(Math.max(length, WINDOW_BYTES), available);
    if (requestLength < length || bytesRead + requestLength > MAX_READ_BYTES) throw preflightError("视频元数据超出预检读取范围");
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
    const response = await fetchMedia(url, {
      headers: { ...baseHeaders, Range: `bytes=${offset}-${offset + requestLength - 1}`, "Accept-Encoding": "identity" },
      signal: requestSignal,
    }, fetchImpl);
    let expectedLength = requestLength;
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(response.headers.get("content-range") || "");
      const rangeStart = Number(match?.[1]);
      const rangeEnd = Number(match?.[2]);
      const rangeTotal = match?.[3] === "*" ? undefined : Number(match?.[3]);
      if (!match || !Number.isSafeInteger(rangeStart) || !Number.isSafeInteger(rangeEnd) || rangeStart !== offset || rangeEnd < rangeStart || rangeEnd >= offset + requestLength || (rangeTotal !== undefined && (!Number.isSafeInteger(rangeTotal) || rangeEnd >= rangeTotal || (totalLength !== undefined && totalLength !== rangeTotal)))) {
        await response.body?.cancel();
        throw preflightError("视频资源返回了无效的字节范围");
      }
      totalLength = rangeTotal ?? totalLength;
      expectedLength = rangeEnd - rangeStart + 1;
    } else if (response.status === 200 && offset === 0) {
      const contentLength = response.headers.get("content-length");
      if (contentLength && /^\d+$/.test(contentLength)) {
        const size = Number(contentLength);
        if (Number.isSafeInteger(size)) totalLength = size;
      }
      // A host may ignore Range. Read only this bounded prefix and cancel;
      // never rescan a full file to reach metadata at a later offset.
      expectedLength = Math.min(requestLength, totalLength ?? requestLength);
    } else {
      await response.body?.cancel();
      throw preflightError(response.status === 200 ? "视频资源不支持所需的字节范围读取" : `视频资源预检请求失败（${response.status}）`);
    }
    if (!response.body) throw preflightError("视频资源没有返回元数据");
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (received < expectedLength) {
        requestSignal.throwIfAborted();
        const { done, value } = await readWithSignal(reader, requestSignal);
        if (done) break;
        bytesRead += value.length;
        if (bytesRead > MAX_READ_BYTES) throw preflightError("视频元数据超出预检读取范围");
        // Body chunks can be larger than the requested range on broken hosts.
        // Keep only the permitted prefix and immediately cancel the remainder.
        const keep = Math.min(value.length, expectedLength - received);
        chunks.push(Buffer.from(value.subarray(0, keep)));
        received += keep;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (received < length || (response.status === 206 && received !== expectedLength)) throw preflightError("视频资源的字节范围数据不完整");
    const buffer = Buffer.concat(chunks, received);
    cache.push({ offset, buffer });
    return buffer.subarray(0, length);
  }

  let offset = 0;
  let hasFileType = false;
  for (let index = 0; index < MAX_TOP_LEVEL_ATOMS; index++) {
    const header = await read(offset, 8);
    const type = header.toString("ascii", 4, 8);
    let size = header.readUInt32BE(0);
    let headerSize = 8;
    if (size === 1) {
      const extended = await read(offset + 8, 8);
      const value = extended.readBigUInt64BE(0);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw preflightError("MP4 元数据偏移超出范围");
      size = Number(value);
      headerSize = 16;
    }
    if (size === 0) {
      if (totalLength === undefined) throw preflightError("视频资源未提供可确认的 MP4 长度");
      size = totalLength - offset;
    }
    if (size < headerSize || !Number.isSafeInteger(offset + size) || (totalLength !== undefined && offset + size > totalLength)) throw preflightError("MP4 元数据长度无效");
    if (type === "ftyp") hasFileType = true;
    if (type === "moov") {
      if (!hasFileType) throw preflightError("视频容器尚未确认为 MP4");
      if (size > MAX_MOOV_BYTES) throw preflightError("MP4 编码元数据超过 2 MiB 限制");
      const tags = declaredVideoCodecs(await read(offset, size));
      const codecTag = tags.find(tag => SUPPORTED_CODECS.has(tag));
      if (!codecTag) throw Object.assign(new Error("链接视频没有支持的 H.264 或 H.265 编码版本。"), {
        code: "UNSUPPORTED_VIDEO_CODEC", statusCode: 422, videoCodecs: tags,
      });
      return { codec: SUPPORTED_CODECS.get(codecTag), codecTag, videoCodecs: tags, bytesRead };
    }
    if (!["ftyp", "free", "wide", "skip", "mdat", "pdin", "uuid", "sidx", "styp", "moof", "mfra"].includes(type)) throw preflightError("视频容器尚未确认为支持的 MP4");
    offset += size;
    if (totalLength !== undefined && offset >= totalLength) break;
  }
  throw preflightError("未在限定范围内找到 MP4 编码元数据");
}
