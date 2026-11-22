/**
 * SQLLens URL Share Snapshot Codec
 *
 * Chuyển đổi hai chiều giữa SnapshotV1 và chuỗi URL fragment:
 * - JSON chuẩn hóa tất định (canonical key sorting, không chèn timestamp).
 * - Nén gzip bằng Web Streams API (CompressionStream/DecompressionStream) hoặc fallback uncompressed.
 * - Mã hóa base64url (RFC 4648 §5: thay '+' bằng '-', '/' bằng '_', bỏ '=').
 * - Kiểm soát trần độ dài SNAPSHOT_HARD_LIMIT_BYTES (32 KB).
 * - 0 byte gửi lên máy chủ (Core Rule 7).
 */

import {
  SnapshotV1,
  SnapshotError,
  SNAPSHOT_HARD_LIMIT_BYTES,
  snapshotTabLimitExceeded,
  validateSnapshotStructure,
} from "./snapshot";

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const B64_LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < 64; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}
// Cho phép cả standard base64 nếu đầu vào có '+' hoặc '/'
B64_LOOKUP["+".charCodeAt(0)] = 62;
B64_LOOKUP["/".charCodeAt(0)] = 63;

/**
 * Chuyển đổi Uint8Array sang chuỗi base64url (không padding, an toàn cho URL).
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let result = "";
  const len = bytes.length;
  let i = 0;

  for (; i + 2 < len; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += B64_CHARS[b0 >> 2];
    result += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)];
    result += B64_CHARS[b2 & 63];
  }

  if (i < len) {
    const b0 = bytes[i];
    result += B64_CHARS[b0 >> 2];
    if (i + 1 < len) {
      const b1 = bytes[i + 1];
      result += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
      result += B64_CHARS[(b1 & 15) << 2];
    } else {
      result += B64_CHARS[(b0 & 3) << 4];
    }
  }

  return result;
}

/**
 * Giải mã chuỗi base64url (hoặc base64 chuẩn) sang Uint8Array.
 * Ném SnapshotError("SNAPSHOT_CORRUPT") nếu phát hiện ký tự không hợp lệ hoặc chuỗi bị cắt cụt.
 */
export function base64UrlToBytes(str: string): Uint8Array {
  let cleanStr = str;
  while (cleanStr.endsWith("=")) {
    cleanStr = cleanStr.slice(0, -1);
  }

  const len = cleanStr.length;
  if (len === 0) {
    return new Uint8Array(0);
  }

  if (len % 4 === 1) {
    throw new SnapshotError("SNAPSHOT_CORRUPT", "Độ dài base64url không hợp lệ (mod 4 === 1)");
  }

  const fullChunks = Math.floor(len / 4);
  const remainder = len % 4;
  const outLen = fullChunks * 3 + (remainder === 2 ? 1 : remainder === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);

  let outIdx = 0;
  let inIdx = 0;

  for (let c = 0; c < fullChunks; c++) {
    const c0 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];
    const c1 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];
    const c2 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];
    const c3 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];

    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
      throw new SnapshotError("SNAPSHOT_CORRUPT", "Ký tự base64url không hợp lệ");
    }

    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
    out[outIdx++] = ((c2 & 3) << 6) | c3;
  }

  if (remainder === 2) {
    const c0 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];
    const c1 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];
    if (c0 < 0 || c1 < 0) {
      throw new SnapshotError("SNAPSHOT_CORRUPT", "Ký tự base64url không hợp lệ");
    }
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
  } else if (remainder === 3) {
    const c0 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];
    const c1 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];
    const c2 = B64_LOOKUP[cleanStr.charCodeAt(inIdx++)];
    if (c0 < 0 || c1 < 0 || c2 < 0) {
      throw new SnapshotError("SNAPSHOT_CORRUPT", "Ký tự base64url không hợp lệ");
    }
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
  }

  return out;
}

/**
 * Chuẩn hóa đối tượng thành chuỗi JSON tất định (sắp xếp key theo bảng chữ cái).
 * Mảng giữ nguyên thứ tự phần tử để bảo toàn thứ tự tab của người dùng.
 */
export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    return `[${val.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(val).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJsonStringify((val as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(",")}}`;
}

/**
 * Nén dữ liệu bằng Web Streams CompressionStream("gzip").
 * Chuẩn hóa các byte MTIME trong header gzip về 0 để kết quả luôn tất định 100%.
 */
async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  const cs = new CompressionStream("gzip");
  const compressedStream = stream.pipeThrough(
    cs as unknown as TransformStream<Uint8Array, Uint8Array>
  );
  const buffer = await new Response(compressedStream).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Chuẩn hóa RFC 1952 gzip header:
  // Byte 0-1: 0x1f, 0x8b; Byte 2: 0x08 (Deflate)
  // Byte 4-7: MTIME -> đưa về 0 để bảo đảm tính tất định tuyệt đối
  // Byte 9: OS -> chuẩn hóa về 255 (unknown OS)
  if (bytes.length >= 10 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes[4] = 0;
    bytes[5] = 0;
    bytes[6] = 0;
    bytes[7] = 0;
    bytes[9] = 255;
  }

  return bytes;
}

/**
 * Giải nén dữ liệu gzip bằng Web Streams DecompressionStream("gzip").
 */
async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });

    const ds = new DecompressionStream("gzip");
    const decompressedStream = stream.pipeThrough(
      ds as unknown as TransformStream<Uint8Array, Uint8Array>
    );
    const buffer = await new Response(decompressedStream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (err) {
    throw new SnapshotError("SNAPSHOT_CORRUPT", "Giải nén dữ liệu gzip thất bại", err);
  }
}

/**
 * Mã hóa đối tượng SnapshotV1 thành chuỗi URL fragment.
 *
 * Định dạng:
 * - Có gzip: "g." + base64url(gzipBytes)
 * - Fallback không nén (khi không có CompressionStream): "u." + base64url(utf8Bytes)
 *
 * @throws {SnapshotError} "SNAPSHOT_VERSION_UNSUPPORTED" nếu version khác 1.
 * @throws {SnapshotError} "SNAPSHOT_TOO_MANY_TABS" nếu snapshot có hơn 100 tab.
 * @throws {SnapshotError} "SNAPSHOT_CORRUPT" nếu cấu trúc snapshot không hợp lệ.
 * @throws {SnapshotError} "SNAPSHOT_TOO_LARGE" nếu chuỗi sau mã hóa vượt quá SNAPSHOT_HARD_LIMIT_BYTES (32KB).
 */
export async function encodeSnapshot(snapshot: SnapshotV1): Promise<string> {
  if (typeof snapshot === "object" && snapshot !== null && "v" in snapshot && snapshot.v !== 1) {
    throw new SnapshotError(
      "SNAPSHOT_VERSION_UNSUPPORTED",
      `Phiên bản snapshot không được hỗ trợ: ${(snapshot as { v: unknown }).v}`,
      { version: (snapshot as { v: unknown }).v }
    );
  }

  if (snapshotTabLimitExceeded(snapshot)) {
    throw new SnapshotError(
      "SNAPSHOT_TOO_MANY_TABS",
      "Snapshot có quá 100 tab nên không tạo được liên kết",
      snapshot
    );
  }

  if (!validateSnapshotStructure(snapshot)) {
    throw new SnapshotError("SNAPSHOT_CORRUPT", "Cấu trúc dữ liệu snapshot không hợp lệ", snapshot);
  }

  const jsonStr = canonicalJsonStringify(snapshot);
  const rawBytes = new TextEncoder().encode(jsonStr);

  let encoded: string;
  const hasCompressionStream = typeof CompressionStream !== "undefined";

  if (hasCompressionStream) {
    const compressed = await compressGzip(rawBytes);
    encoded = "g." + bytesToBase64Url(compressed);
  } else {
    // Fallback uncompressed khi môi trường không có CompressionStream
    encoded = "u." + bytesToBase64Url(rawBytes);
  }

  if (encoded.length > SNAPSHOT_HARD_LIMIT_BYTES) {
    throw new SnapshotError(
      "SNAPSHOT_TOO_LARGE",
      `Kích thước snapshot (${encoded.length} bytes) vượt quá giới hạn cứng ${SNAPSHOT_HARD_LIMIT_BYTES} bytes`,
      { size: encoded.length, limit: SNAPSHOT_HARD_LIMIT_BYTES }
    );
  }

  return encoded;
}

/**
 * Giải mã chuỗi URL fragment thành đối tượng SnapshotV1.
 *
 * Hỗ trợ nhận diện tự động:
 * - Tiền tố "g." hoặc "n1.": nén gzip
 * - Tiền tố "u." hoặc "n0.": không nén
 * - Không tiền tố: tự động nhận diện magic bytes gzip (0x1f, 0x8b)
 *
 * @throws {SnapshotError} "SNAPSHOT_CORRUPT" nếu chuỗi rỗng, sai base64url, gzip lỗi hoặc JSON hỏng.
 * @throws {SnapshotError} "SNAPSHOT_VERSION_UNSUPPORTED" nếu trường v khác 1.
 * @throws {SnapshotError} "SNAPSHOT_TOO_LARGE" nếu payload vượt quá SNAPSHOT_HARD_LIMIT_BYTES.
 */
export async function decodeSnapshot(payload: string): Promise<SnapshotV1> {
  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new SnapshotError("SNAPSHOT_CORRUPT", "Chuỗi payload snapshot rỗng hoặc không hợp lệ");
  }

  if (payload.length > SNAPSHOT_HARD_LIMIT_BYTES) {
    throw new SnapshotError(
      "SNAPSHOT_TOO_LARGE",
      `Chuỗi payload snapshot (${payload.length} bytes) vượt quá giới hạn tối đa ${SNAPSHOT_HARD_LIMIT_BYTES} bytes`,
      { size: payload.length, limit: SNAPSHOT_HARD_LIMIT_BYTES }
    );
  }

  let isGzip = false;
  let b64 = payload;

  if (payload.startsWith("g.")) {
    isGzip = true;
    b64 = payload.slice(2);
  } else if (payload.startsWith("n1.")) {
    isGzip = true;
    b64 = payload.slice(3);
  } else if (payload.startsWith("u.")) {
    isGzip = false;
    b64 = payload.slice(2);
  } else if (payload.startsWith("n0.")) {
    isGzip = false;
    b64 = payload.slice(3);
  }

  if (b64.length === 0) {
    throw new SnapshotError("SNAPSHOT_CORRUPT", "Chuỗi payload không có dữ liệu sau tiền tố");
  }

  const bytes = base64UrlToBytes(b64);

  // Nếu không có tiền tố nhận diện, kiểm tra magic bytes của gzip
  if (!payload.startsWith("g.") && !payload.startsWith("n1.") && !payload.startsWith("u.") && !payload.startsWith("n0.")) {
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      isGzip = true;
    } else {
      isGzip = false;
    }
  }

  let jsonStr: string;

  if (isGzip) {
    if (typeof DecompressionStream === "undefined") {
      throw new SnapshotError("SNAPSHOT_CORRUPT", "Môi trường hiện tại không hỗ trợ DecompressionStream");
    }
    const decompressedBytes = await decompressGzip(bytes);
    jsonStr = new TextDecoder().decode(decompressedBytes);
  } else {
    jsonStr = new TextDecoder().decode(bytes);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new SnapshotError("SNAPSHOT_CORRUPT", "Cú pháp JSON không hợp lệ", err);
  }

  if (typeof parsed === "object" && parsed !== null && "v" in parsed && (parsed as Record<string, unknown>).v !== 1) {
    throw new SnapshotError(
      "SNAPSHOT_VERSION_UNSUPPORTED",
      `Phiên bản snapshot không được hỗ trợ: ${(parsed as Record<string, unknown>).v}`,
      { version: (parsed as Record<string, unknown>).v }
    );
  }

  if (snapshotTabLimitExceeded(parsed)) {
    throw new SnapshotError(
      "SNAPSHOT_TOO_MANY_TABS",
      "Snapshot có quá 100 tab nên không mở được",
      parsed
    );
  }

  if (!validateSnapshotStructure(parsed)) {
    throw new SnapshotError("SNAPSHOT_CORRUPT", "Cấu trúc dữ liệu snapshot không hợp lệ", parsed);
  }

  return parsed;
}
