import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BTreeSvgError, exportBTreeSvg, findBTreeSvg } from "./btree-svg";

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Cây giả lập đúng cấu trúc BTreeView vẽ: g[data-page] > rect + line + text, đường nối là path.
 * `levels` để dựng cây 1 node / 3 tầng / 4 tầng; `lit` dựng node đang tô sáng.
 */
function makeTree(opts: { levels?: number; nodesPerLevel?: number; lit?: boolean; light?: boolean; keep?: boolean } = {}) {
  const { levels = 2, nodesPerLevel = 2, lit = false } = opts;
  if (!opts.keep) document.body.innerHTML = "";
  const stage = document.createElement("div");
  stage.style.backgroundColor = opts.light ? "#ffffff" : "#0b0d10";
  const svg = el("svg", {
    width: "600",
    height: String(80 * levels + 40),
    "data-testid": "btree-svg",
    "aria-label": "Chỉ mục idx_users_email trên bảng users",
    role: "group",
  });
  let page = 1;
  for (let level = 0; level < levels; level += 1) {
    for (let i = 0; i < nodesPerLevel; i += 1) {
      const current = page;
      const g = el("g", { transform: `translate(${40 + i * 200} ${40 + level * 80})`, "data-page": String(current) });
      const rect = el("rect", { width: "168", height: "30", rx: "2", class: "fill-card stroke-control" });
      rect.style.fill = level === 0 ? "#112233" : "#223344";
      rect.style.stroke = "#556677";
      const line = el("line", { x1: "56", x2: "56", y1: "0", y2: "30", class: "stroke-control" });
      const text = el("text", { x: "28", y: "20", "text-anchor": "middle", class: "fill-ink2" });
      text.style.font = "12.5px var(--mono)";
      text.textContent = `key-${current}`;
      const title = el("title");
      title.textContent = `Trang ${current}`;
      g.append(title, rect, line, text);
      if (lit && level === levels - 1 && i === 0) g.setAttribute("data-lit", "true");
      svg.appendChild(g);
      if (current > 1) {
        const path = el("path", { d: `M${40 + i * 200} 70C100 90 120 100 140 110`, "data-edge": "child" });
        path.style.stroke = "#8899aa";
        svg.appendChild(path);
      }
      page += 1;
    }
  }
  stage.appendChild(svg);
  document.body.appendChild(stage);
  return svg;
}

/** jsdom chuẩn hoá màu về rgb(...), trình duyệt thật có thể giữ nguyên mã hex. */
function expectColor(actual: string | null, hex: string) {
  const rgb = hex.replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`);
  expect([hex, rgb]).toContain(actual);
}

async function open(blob: Blob): Promise<Document> {
  const text = await blob.text();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  return doc;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network must not be used"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Task140: xuất cây B-Tree thành SVG vector", () => {
  it("AC1/AC3: file là SVG hợp lệ, có xmlns + viewBox, không nhúng ảnh raster", async () => {
    const svg = makeTree({ levels: 3 });
    const blob = exportBTreeSvg(svg, { title: "Cây B-Tree của dự án A" });

    expect(blob.type).toContain("image/svg+xml");
    const doc = await open(blob);
    const root = doc.documentElement;
    expect(root.tagName.toLowerCase()).toBe("svg");
    expect(root.getAttribute("xmlns")).toBe(NS);
    expect(root.getAttribute("viewBox")).toBe("0 0 600 280");
    expect(Number(root.getAttribute("width"))).toBe(600);
    expect(Number(root.getAttribute("height"))).toBe(280);
    expect(doc.querySelector("image")).toBeNull();
  });

  it("AC2: giữ nguyên số node, nhãn key và đường nối sau khi mở lại", async () => {
    const svg = makeTree({ levels: 4, nodesPerLevel: 2 });
    const beforePages = [...svg.querySelectorAll("g[data-page]")].map((g) => g.getAttribute("data-page"));
    const beforeText = [...svg.querySelectorAll("g[data-page] text")].map((t) => t.textContent);
    const beforeEdges = [...svg.querySelectorAll("path[data-edge]")].map((p) => p.getAttribute("d"));

    const doc = await open(exportBTreeSvg(svg, { title: "B-Tree" }));

    expect([...doc.querySelectorAll("g[data-page]")].map((g) => g.getAttribute("data-page"))).toEqual(beforePages);
    expect([...doc.querySelectorAll("g[data-page] text")].map((t) => t.textContent)).toEqual(beforeText);
    expect([...doc.querySelectorAll("path[data-edge]")].map((p) => p.getAttribute("d"))).toEqual(beforeEdges);
  });

  it("AC4: có title + desc cho trợ năng, root là role=img", async () => {
    const svg = makeTree();
    const doc = await open(exportBTreeSvg(svg, { title: "Cây B-Tree của dự án A" }));
    const root = doc.documentElement;
    expect(root.getAttribute("role")).toBe("img");
    expect(root.querySelector(":scope > title")?.textContent).toBe("Cây B-Tree của dự án A");
    expect(root.querySelector(":scope > desc")?.textContent).toContain("idx_users_email");
    expect(root.getAttribute("aria-describedby")).toBeNull();
  });

  it("AC4: cây bị làm mờ thì desc nói rõ lý do, không để file tự mâu thuẫn", async () => {
    const svg = makeTree();
    const view = document.createElement("div");
    view.setAttribute("data-testid", "btree-view");
    const notice = document.createElement("div");
    notice.setAttribute("data-testid", "btree-dimmed-notice");
    notice.textContent = "Index idx_users_email không được dùng: câu này đọc cả bảng.";
    const stage = svg.parentElement!;
    view.append(notice, svg);
    stage.appendChild(view);

    const doc = await open(exportBTreeSvg(svg, { title: "B-Tree" }));
    const desc = doc.querySelector(":scope > desc")?.textContent ?? "";
    expect(desc).toContain("idx_users_email");
    expect(desc).toContain("không được dùng");
  });

  it("AC5: cây đang animation vẫn ra trạng thái tĩnh, không lẫn lớp phủ (viên bi/heap)", async () => {
    const svg = makeTree({ levels: 3 });
    // BTreeDrop portal lớp phủ vào vùng cuộn, cạnh cây — mô phỏng đúng DOM thật.
    const overlay = el("svg", { "data-testid": "btree-drop-layer", "aria-hidden": "true" });
    const heap = el("g", { "data-heap": "" });
    const marker = el("g", { "data-key": "" });
    marker.textContent = "k1";
    overlay.append(heap, marker);
    svg.parentElement!.appendChild(overlay);

    const doc = await open(exportBTreeSvg(svg, { title: "B-Tree" }));
    expect(doc.querySelector("[data-heap]")).toBeNull();
    expect(doc.querySelector("[data-key]")).toBeNull();
    expect(doc.querySelector("[data-testid='btree-drop-layer']")).toBeNull();
    expect(doc.querySelectorAll("g[data-page]").length).toBe(svg.querySelectorAll("g[data-page]").length);
  });

  it("AC6: không có request mạng nào khi xuất", () => {
    const svg = makeTree();
    exportBTreeSvg(svg, { title: "B-Tree" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("nhúng style đã tính và bỏ class để không phụ thuộc CSS ngoài", async () => {
    const svg = makeTree();
    // `fill`/`stroke` là thuộc tính trình bày của SVG, jsdom không tính vào computed style;
    // `opacity` là thuộc tính CSS thật nên kiểm được ở đây, còn nét vẽ được kiểm trên Chrome thật.
    const path = svg.querySelector("path[data-edge]")! as SVGPathElement;
    path.style.opacity = "0.5";
    const doc = await open(exportBTreeSvg(svg, { title: "B-Tree" }));
    const rect = doc.querySelector("g[data-page] rect")!;
    expect(rect.getAttribute("class")).toBeNull();
    const exportedPath = doc.querySelector("path[data-edge]")!;
    expect(exportedPath.getAttribute("class")).toBeNull();
    expect(exportedPath.getAttribute("style")).toContain("opacity:0.5");
  });

  it("nền lấy từ khung chứa: theme tối và theme sáng đều đọc được", async () => {
    const dark = await open(exportBTreeSvg(makeTree(), { title: "B-Tree" }));
    const darkFill = dark.querySelector("svg > rect")?.getAttribute("fill") ?? null;
    expectColor(darkFill, "#0b0d10");

    const light = await open(exportBTreeSvg(makeTree({ light: true }), { title: "B-Tree" }));
    const lightFill = light.querySelector("svg > rect")?.getAttribute("fill") ?? null;
    expectColor(lightFill, "#ffffff");
    expect(darkFill).not.toBe(lightFill);
  });

  it("không sửa DOM đang hiển thị", () => {
    const svg = makeTree();
    const before = svg.outerHTML;
    exportBTreeSvg(svg, { title: "B-Tree" });
    expect(svg.outerHTML).toBe(before);
  });

  describe("Ca biên", () => {
    it("cây 1 node vẫn xuất đủ node và nhãn", async () => {
      const svg = makeTree({ levels: 1, nodesPerLevel: 1 });
      const doc = await open(exportBTreeSvg(svg, { title: "B-Tree" }));
      expect(doc.querySelectorAll("g[data-page]").length).toBe(1);
      expect(doc.querySelector("g[data-page] text")?.textContent).toBe("key-1");
    });

    it("cây 4 tầng giữ nguyên data-lit của node đang highlight", async () => {
      const svg = makeTree({ levels: 4, nodesPerLevel: 1, lit: true });
      const doc = await open(exportBTreeSvg(svg, { title: "B-Tree" }));
      expect(doc.querySelector("g[data-lit='true']")).not.toBeNull();
      expect(doc.querySelector("g[data-lit='true']")?.getAttribute("data-page")).toBe("4");
    });

    it("cây rỗng (chưa có node) vẫn ra file SVG hợp lệ", async () => {
      document.body.innerHTML = "";
      const svg = el("svg", { width: "320", height: "200", "data-testid": "btree-svg" });
      document.body.appendChild(svg);
      const doc = await open(exportBTreeSvg(svg, { title: "B-Tree rỗng" }));
      expect(doc.documentElement.tagName.toLowerCase()).toBe("svg");
      expect(doc.querySelector(":scope > title")?.textContent).toBe("B-Tree rỗng");
    });

    it("SVG không có kích thước thì báo lỗi rõ ràng, không tạo file hỏng", () => {
      document.body.innerHTML = "";
      const svg = el("svg", { "data-testid": "btree-svg" });
      document.body.appendChild(svg);
      expect(() => exportBTreeSvg(svg, { title: "B-Tree" })).toThrow(BTreeSvgError);
      try {
        exportBTreeSvg(svg, { title: "B-Tree" });
      } catch (e) {
        expect((e as BTreeSvgError).code).toBe("no_size");
      }
    });
  });

  describe("findBTreeSvg", () => {
    it("trả null khi trang chưa có cây", () => {
      document.body.innerHTML = "";
      expect(findBTreeSvg(document)).toBeNull();
    });

    it("ưu tiên cây đang nhìn thấy, không có thì lấy cây đầu tiên", () => {
      const first = makeTree();
      const second = makeTree({ keep: true });
      // jsdom không layout: mặc định cả hai đều 0 rộng -> lấy cây đầu.
      expect(findBTreeSvg(document)).toBe(first);

      second.getBoundingClientRect = () =>
        ({ width: 600, height: 280, top: 0, left: 0, right: 600, bottom: 280, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      expect(findBTreeSvg(document)).toBe(second);
    });
  });
});
