"use client";

import { domToCanvas } from "modern-screenshot";

/**
 * Chụp sơ đồ bảng (ERD) thành PNG, chạy hoàn toàn trong trình duyệt (Core Rule 7: ảnh không rời máy).
 *
 * Nguyên tắc của ảnh: đúng vùng canvas người dùng đang thấy, không có nút điều khiển, không có
 * minimap, không viền thừa, không nền trong suốt (dán vào tài liệu nền trắng vẫn đọc được).
 */

/** Khung canvas của sơ đồ (xem `schema-diagram-impl.tsx`). */
export const ERD_CANVAS_SELECTOR = '[data-testid="schema-canvas"]';
const VIEWPORT_SELECTOR = ".react-flow__viewport";

/** Thứ không bao giờ được có trong ảnh, kể cả sau này sơ đồ có thêm. */
const NEVER_CAPTURE = [
  ".react-flow__minimap",
  ".react-flow__controls",
  ".react-flow__panel",
  ".react-flow__attribution",
  ".react-flow__handle",
];

/** Cạnh tối đa của canvas chụp ảnh: vượt mức này trình duyệt trả canvas rỗng (ảnh trắng). */
const MAX_SIDE = 16_384;
/** Tổng điểm ảnh tối đa: giữ dưới ngưỡng canvas hay chết trên máy yếu. */
const MAX_AREA = 100_000_000;

/** Lề quanh sơ đồ trong ảnh (px thế giới): đủ để không cắt viền thẻ, không thành viền thừa. */
const PAD = 24;

export type ErdCaptureStep = "prepare" | "capture" | "encode";

export type ErdCaptureErrorCode = "not_found" | "too_large" | "failed";

export class ErdCaptureError extends Error {
  constructor(
    public readonly code: ErdCaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ErdCaptureError";
  }
}

export interface ErdCaptureOptions {
  /** Gốc để tìm sơ đồ; mặc định `document`. */
  root?: ParentNode;
  /** Ảnh gấp bao nhiêu lần kích thước CSS. Mặc định 2 (AC2). */
  scale?: number;
  /** Ép kích thước khung, tính bằng px CSS; mặc định đo từ canvas. */
  width?: number;
  height?: number;
  onProgress?: (step: ErdCaptureStep) => void;
}

/**
 * Kích thước khung canvas khi không đo được (tab sơ đồ đang ẩn: mọi `getBoundingClientRect` trả 0).
 * Dùng đúng luật CSS của canvas: rộng hết phần còn lại của Lab, cao 60vh — nên ảnh vẫn đúng tỉ lệ.
 */
function fallbackFrame(): { width: number; height: number } {
  const view = (typeof window !== "undefined" ? window : undefined) as Window | undefined;
  const w = view?.innerWidth ?? 1024;
  const h = view?.innerHeight ?? 768;
  return { width: Math.max(320, w - 64), height: Math.max(240, Math.round(h * 0.6)) };
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Biên của toàn bộ sơ đồ theo toạ độ thế giới, đọc từ chính thẻ bảng.
 *
 * Dùng biên nội dung thay vì khung canvas vì hai lẽ: (1) tab sơ đồ đang ẩn không đo được khung nào
 * (`display: none` → 0×0) nhưng toạ độ thẻ thì vẫn còn; (2) ảnh ra sát sơ đồ, không có khoảng trống
 * thừa của khung nhìn, nên dán vào tài liệu là vừa. Trả `null` khi không đọc được thẻ nào.
 */
export function contentBounds(viewport: HTMLElement): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = 0;

  viewport.querySelectorAll<HTMLElement>(".react-flow__node").forEach((node) => {
    // React Flow đặt vị trí thẻ bằng `transform: translate(Xpx, Ypx)` trong toạ độ thế giới.
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(node.style.transform);
    if (!m) return;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const w = parseFloat(node.style.width) || node.offsetWidth || 0;
    const h = parseFloat(node.style.height) || node.offsetHeight || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return;
    seen += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  if (seen === 0) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function clampSide(n: number): number {
  return Math.max(1, Math.round(n));
}

/**
 * Chọn tỉ lệ chụp thật: mong muốn 2 (AC2), nhưng hạ xuống khi ảnh sẽ vượt giới hạn canvas.
 *
 * Không bao giờ **cắt bớt** sơ đồ để vừa giới hạn: cắt là ảnh nói dối (mất bảng mà không ai biết).
 * Thà hạ độ nét rồi báo, và nếu hạ tới 1 lần vẫn quá lớn thì từ chối kèm lý do (Core Rule 4).
 */
export function planScale(width: number, height: number, requested = 2): number {
  const bySide = Math.min(MAX_SIDE / width, MAX_SIDE / height);
  const byArea = Math.sqrt(MAX_AREA / (width * height));
  const scale = Math.min(requested, bySide, byArea);
  if (scale < 1) {
    throw new ErdCaptureError(
      "too_large",
      `Diagram too large to capture: ${Math.round(width)}×${Math.round(height)} CSS px`,
    );
  }
  return Math.floor(scale * 100) / 100;
}

/** Bỏ nút điều khiển/minimap/handle khỏi bản sao trước khi chụp. Tách riêng để kiểm thử được. */
export function pruneCaptureClone<T extends HTMLElement>(clone: T): T {
  for (const sel of NEVER_CAPTURE) clone.querySelectorAll(sel).forEach((n) => n.remove());
  clone.querySelectorAll<HTMLElement>('[aria-hidden="true"]').forEach((n) => {
    if (n.tagName === "svg") n.remove();
  });
  return clone;
}

/**
 * Tab sơ đồ đang ẩn (`display: none`) làm React Flow đo ra 0 px: nó dồn thẻ thành cột và **xoá đường
 * nối khoá ngoại** khỏi DOM. Chụp luôn lúc đó sẽ ra ảnh thiếu thông tin.
 *
 * Cách chữa: trả layout cho canvas bằng `display` thật nhưng `visibility: hidden` để không nháy giao
 * diện, chờ React Flow đo lại (thẻ có bề rộng, edge quay về), chụp, rồi trả nguyên trạng.
 */
function revealLayout(canvas: HTMLElement): { restore: () => void; patched: number } {
  const patched: { el: HTMLElement; display: string }[] = [];
  let el: HTMLElement | null = canvas.parentElement;
  while (el && el !== document.body) {
    if (getComputedStyle(el).display === "none") {
      patched.push({ el, display: el.style.display });
      el.style.setProperty("display", "block", "important");
      el.style.setProperty("visibility", "hidden", "important");
    }
    el = el.parentElement;
  }
  return {
    patched: patched.length,
    restore: () => {
      for (const { el: node, display } of patched) {
        node.style.removeProperty("visibility");
        node.style.removeProperty("display");
        if (display) node.style.display = display;
      }
    },
  };
}

/**
 * Dấu vân tay của layout: biên thẻ + số đường nối. Đổi layout là đổi dấu vân tay.
 *
 * Không dùng kích thước khung thay cho dấu vân tay: khung có bề rộng ngay khi CSS đổi, còn vị trí
 * thẻ thì do React Flow tính lại ở nhịp render sau — chụp sớm là chụp đúng lúc sơ đồ còn dồn thành
 * một cột của chế độ hẹp (ảnh ra cột dọc, mất đường nối) dù khung đã rộng.
 */
function layoutSignature(canvas: HTMLElement): string | null {
  const viewport = canvas.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
  const bounds = viewport ? contentBounds(viewport) : null;
  if (!bounds) return null;
  const edges = canvas.querySelectorAll(".react-flow__edge").length;
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}|${edges}`;
}

async function waitForLayout(canvas: HTMLElement): Promise<void> {
  const deadline = Date.now() + 1_500;
  let last: string | null = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const nodes = [...canvas.querySelectorAll<HTMLElement>(".react-flow__node")];
    // `offsetWidth` là bề rộng đã đo; thẻ có `style.width` (React Flow đặt sẵn) cũng đủ để tính biên.
    const sized = nodes.length > 0 && nodes.every((n) => n.offsetWidth > 0 || parseFloat(n.style.width) > 0);
    if (canvas.getBoundingClientRect().width > 0 && sized) {
      const sig = layoutSignature(canvas);
      if (sig !== null && sig === last) {
        if (++stable >= 6) return; // 6 nhịp liền nhau không đổi: layout đã yên
      } else {
        stable = 0;
      }
      last = sig;
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new ErdCaptureError("failed", "Canvas produced no image data"));
    }, "image/png");
  });
}

/**
 * Chụp `.react-flow__viewport` ra PNG.
 *
 * Tab sơ đồ đang ẩn vẫn chụp được: bản sao được gắn vào một khung off-screen có kích thước xác định
 * nên không phụ thuộc layout của tab đang hiện (AC4).
 */
export async function captureErdPng(opts: ErdCaptureOptions = {}): Promise<Blob> {
  const root = opts.root ?? (typeof document !== "undefined" ? document : undefined);
  if (!root) throw new ErdCaptureError("not_found", "No document to capture from");

  opts.onProgress?.("prepare");

  const canvas = root.querySelector<HTMLElement>(ERD_CANVAS_SELECTOR) ?? root.querySelector<HTMLElement>(".react-flow");
  if (!canvas) throw new ErdCaptureError("not_found", "ERD canvas not found");

  // Tab đang ẩn: mở layout ra một nhịp (không nhìn thấy) để sơ đồ có lại đường nối và bề rộng thẻ.
  const hidden = canvas.getBoundingClientRect().width <= 0;
  const reveal = hidden ? revealLayout(canvas) : { restore: () => {}, patched: 0 };
  try {
    // Chỉ chờ khi thật sự có lớp bị `display: none` vừa được mở: không mở được lớp nào thì layout
    // không đổi nữa, chờ thêm chỉ làm người dùng đợi vô ích.
    if (hidden && reveal.patched > 0) await waitForLayout(canvas);
    return await shoot(canvas, opts);
  } finally {
    reveal.restore();
  }
}

async function shoot(canvas: HTMLElement, opts: ErdCaptureOptions): Promise<Blob> {
  const viewport = canvas.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
  if (!viewport) throw new ErdCaptureError("not_found", "ERD viewport not found");

  // Khung ảnh: biên nội dung sơ đồ + lề; không đọc được thẻ nào thì lui về khung canvas đang thấy
  // (và cuối cùng là kích thước mặc định khi tab ẩn), để không bao giờ ném lỗi vì phép đo.
  const bounds = contentBounds(viewport);
  const rect = canvas.getBoundingClientRect();
  const fallback = fallbackFrame();
  const width = clampSide(opts.width ?? (bounds ? bounds.width + PAD * 2 : rect.width > 0 ? rect.width : fallback.width));
  const height = clampSide(opts.height ?? (bounds ? bounds.height + PAD * 2 : rect.height > 0 ? rect.height : fallback.height));
  const background =
    (typeof getComputedStyle === "function" ? getComputedStyle(canvas).backgroundColor : "") || "#0b0d10";

  const host = document.createElement("div");
  host.dataset.erdCaptureHost = "";
  host.setAttribute("aria-hidden", "true");
  // Ẩn khỏi mắt người nhưng vẫn có layout thật: `display: none` sẽ làm ảnh trắng.
  host.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    `width:${width}px`,
    `height:${height}px`,
    "overflow:hidden",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");

  const clone = pruneCaptureClone(viewport.cloneNode(true) as HTMLElement);
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.transformOrigin = "0 0";
  // Đưa biên nội dung về gốc khung: bỏ phép pan/zoom của người dùng, ảnh luôn cùng một khung chuẩn.
  clone.style.transform = bounds
    ? `translate(${PAD - bounds.x}px, ${PAD - bounds.y}px) scale(1)`
    : clone.style.transform;
  host.appendChild(clone);

  try {
    document.body.appendChild(host);
    await waitFrame(); // để font/ảnh trong thẻ bảng kịp áp lên bản sao

    opts.onProgress?.("capture");
    const drawn = await domToCanvas(clone, {
      width,
      height,
      scale: planScale(width, height, opts.scale ?? 2),
      backgroundColor: background,
      style: { width: `${width}px`, height: `${height}px`, margin: "0" },
      timeout: 15_000,
    });

    opts.onProgress?.("encode");
    return await toBlob(drawn);
  } catch (e) {
    throw e instanceof ErdCaptureError
      ? e
      : new ErdCaptureError("failed", e instanceof Error ? e.message : String(e));
  } finally {
    host.remove();
  }
}
