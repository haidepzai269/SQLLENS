"use client";

/**
 * Xuất cây B-Tree đang vẽ thành SVG vector, chạy hoàn toàn trong trình duyệt
 * (Core Rule 7: file không rời máy, không request mạng).
 *
 * Vì sao phải nhúng style: cây trên màn hình tô màu bằng class Tailwind và biến CSS
 * (`fill-card`, `stroke-lamp`, `var(--mono)`). Mở file SVG ở trình xem vector không có
 * stylesheet của app, nên nếu chỉ serialize DOM thì mọi nét và chữ sẽ mất màu/phông.
 * Cách làm: sao chép cây, rồi chép giá trị *đã tính* của từng phần tử vào `style`.
 */

export const BTREE_SVG_SELECTOR = '[data-testid="btree-svg"]';

export type BTreeSvgErrorCode = "no_size";

export class BTreeSvgError extends Error {
  constructor(
    public readonly code: BTreeSvgErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BTreeSvgError";
  }
}

/** Thuộc tính vẽ và chữ cần chép từ computed style; đủ để cây đứng một mình. */
const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "visibility",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "shape-rendering",
] as const;

export interface BTreeSvgOptions {
  /** Tiêu đề của file, dùng cho `<title>` (AC4). */
  title: string;
}

/**
 * Tìm cây B-Tree để xuất trong trang.
 *
 * Tab B-Tree được giữ mounted nên cây vẫn còn trong DOM khi người dùng đang ở tab khác;
 * ưu tiên cây đang nhìn thấy, không có thì lấy cây đầu tiên theo thứ tự DOM (trường hợp
 * Bookmark Lookup có hai cây, cây đầu là secondary index — cây của câu đang xem).
 */
export function findBTreeSvg(root?: ParentNode): SVGSVGElement | null {
  const scope = root ?? (typeof document !== "undefined" ? document : undefined);
  if (!scope) return null;
  const all = [...scope.querySelectorAll<SVGSVGElement>(BTREE_SVG_SELECTOR)];
  if (all.length === 0) return null;
  return all.find((svg) => (svg.getBoundingClientRect?.().width ?? 0) > 0) ?? all[0];
}

function computed(source: Element): CSSStyleDeclaration | null {
  if (typeof getComputedStyle !== "function") return null;
  try {
    return getComputedStyle(source);
  } catch {
    return null;
  }
}

/** Chép style đã tính sang bản sao, bỏ class để file không phụ thuộc CSS ngoài. */
function inlineStyles(source: Element, target: Element): void {
  const cs = computed(source);
  if (!cs) return;
  const parts: string[] = [];
  for (const prop of STYLE_PROPS) {
    const value = cs.getPropertyValue(prop);
    if (value && value !== "normal") parts.push(`${prop}:${value}`);
  }
  if (parts.length > 0) target.setAttribute("style", parts.join(";"));
  else target.removeAttribute("style");
  target.removeAttribute("class");
}

function pixelSize(svg: SVGSVGElement): { width: number; height: number } | null {
  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  const rect = svg.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  return null;
}

const isTransparent = (color: string) =>
  !color || color === "transparent" || /^rgba?\([^)]*,\s*0\s*\)$/.test(color);

/**
 * Nền của file: lấy màu nền đã tính của khung chứa gần nhất (nền stage, hợp cả theme
 * sáng lẫn tối). Không tìm được thì dùng biến `--stage` của app, cuối cùng là nền tối
 * mặc định của stage. Không bao giờ để nền trong suốt: chữ sáng trên nền trắng sẽ mất.
 */
function backgroundColor(svg: SVGSVGElement): string {
  let el: Element | null = svg;
  while (el) {
    const c = computed(el)?.backgroundColor;
    if (c && !isTransparent(c)) return c;
    el = el.parentElement;
  }
  if (typeof document !== "undefined") {
    const stage = computed(document.documentElement)?.getPropertyValue("--stage").trim();
    if (stage) return stage;
  }
  return "#0b0d10";
}

/**
 * Lý do cây bị làm mờ (index không được dùng) nằm ngoài SVG, trong khung BTreeView.
 * Không có nó, file chỉ còn một cây mờ 22% mà không ai biết vì sao — dễ đọc thành "cây hỏng".
 * Nên chép vào `<desc>` để file tự nói đúng điều màn hình đang nói (Core Rule 2 và 4).
 */
function dimReasonOf(element: SVGSVGElement): string {
  const view = element.closest('[data-testid="btree-view"]');
  return view?.querySelector('[data-testid="btree-dimmed-notice"]')?.textContent?.trim() ?? "";
}

function stripInteractive(clone: Element): void {
  for (const el of [clone, ...clone.querySelectorAll("*")]) {
    el.removeAttribute("tabindex");
    el.removeAttribute("data-testid");
    el.removeAttribute("aria-describedby");
    el.removeAttribute("role"); // file là ảnh tĩnh, không còn nút kéo được bên trong
  }
  clone.removeAttribute("aria-label");
  clone.setAttribute("role", "img");
}

/**
 * Xuất cây B-Tree thành SVG vector.
 *
 * Kết quả là vector thật (không nhúng ảnh): phóng to bao nhiêu lần cũng sắc nét (AC3).
 * Cây đang chạy animation vẫn ra trạng thái tĩnh: lớp phủ animation (viên bi, đường sáng,
 * heap) là SVG anh em được portal vào vùng cuộn, không nằm trong phần tử cây, nên không
 * bao giờ lọt vào file (AC5).
 */
export function exportBTreeSvg(element: SVGSVGElement, { title }: BTreeSvgOptions): Blob {
  const size = pixelSize(element);
  if (!size) {
    throw new BTreeSvgError("no_size", "B-Tree SVG has no measurable size");
  }

  const clone = element.cloneNode(true) as SVGSVGElement;
  const sources = [element, ...element.querySelectorAll("*")];
  const targets = [clone, ...clone.querySelectorAll("*")];
  for (let i = 0; i < sources.length && i < targets.length; i += 1) {
    inlineStyles(sources[i], targets[i]);
  }

  stripInteractive(clone);
  // `XMLSerializer` tự phát `xmlns` cho phần tử SVG; đặt tay sẽ thành thuộc tính trùng và file không mở được.
  clone.setAttribute("width", String(Math.round(size.width)));
  clone.setAttribute("height", String(Math.round(size.height)));
  // Giữ viewBox cũ nếu có (toạ độ thế giới của cây); không có thì dựng từ kích thước.
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${Math.round(size.width)} ${Math.round(size.height)}`);
  }

  const doc = clone.ownerDocument;
  const titleEl = doc.createElementNS("http://www.w3.org/2000/svg", "title");
  titleEl.textContent = title;
  const descEl = doc.createElementNS("http://www.w3.org/2000/svg", "desc");
  descEl.textContent = [element.getAttribute("aria-label")?.trim(), dimReasonOf(element)].filter(Boolean).join(". ") || title;

  const width = Math.round(size.width);
  const height = Math.round(size.height);
  const bg = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", backgroundColor(element));

  clone.insertBefore(bg, clone.firstChild);
  clone.insertBefore(descEl, bg);
  clone.insertBefore(titleEl, descEl);

  const xml = new XMLSerializer().serializeToString(clone);
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], {
    type: "image/svg+xml;charset=utf-8",
  });
}
