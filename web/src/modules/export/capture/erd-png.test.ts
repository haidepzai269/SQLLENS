import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  /** Canvas giả mà `domToCanvas` trả về; `null` = nén ảnh thất bại. */
  canvas: null as null | { toBlob: (cb: BlobCallback, type?: string) => void },
}));

vi.mock("modern-screenshot", () => ({
  domToCanvas: vi.fn(async () => hoisted.canvas),
}));

import { domToCanvas } from "modern-screenshot";
import { captureErdPng, ErdCaptureError, planScale, pruneCaptureClone } from "./erd-png";

const domToCanvasMock = vi.mocked(domToCanvas);

/** `domToCanvas` có overload nhận `Context`; test chỉ dùng bản `(node, options)`. */
function captureCalls(): [HTMLElement, { scale?: number; width?: number; height?: number; backgroundColor?: string } | undefined][] {
  return domToCanvasMock.mock.calls as unknown as [HTMLElement, { scale?: number; width?: number; height?: number; backgroundColor?: string } | undefined][];
}

/** Dựng khung canvas + viewport giống `schema-diagram-impl.tsx`. */
function mountDiagram(rect: { width: number; height: number } = { width: 1200, height: 700 }) {
  const canvas = document.createElement("div");
  canvas.setAttribute("data-testid", "schema-canvas");
  canvas.getBoundingClientRect = () =>
    ({ width: rect.width, height: rect.height, top: 0, left: 0, right: rect.width, bottom: rect.height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  const viewport = document.createElement("div");
  viewport.className = "react-flow__viewport";
  viewport.style.transform = "translate(-20px, -10px) scale(0.9)";

  // Hai thẻ bảng trong toạ độ thế giới: (40,60) 200×120 và (300,60) 200×120.
  const node = document.createElement("div");
  node.className = "react-flow__node react-flow__node-table";
  node.style.transform = "translate(40px, 60px)";
  node.style.width = "200px";
  node.style.height = "120px";
  node.textContent = "users";
  const node2 = document.createElement("div");
  node2.className = "react-flow__node react-flow__node-table";
  node2.style.transform = "translate(300px, 60px)";
  node2.style.width = "200px";
  node2.style.height = "120px";
  node2.textContent = "posts";
  viewport.append(node, node2);

  const minimap = document.createElement("div");
  minimap.className = "react-flow__minimap";
  const controls = document.createElement("div");
  controls.className = "react-flow__controls";
  const panel = document.createElement("div");
  panel.className = "react-flow__panel";
  const handle = document.createElement("div");
  handle.className = "react-flow__handle";

  canvas.append(viewport, minimap, controls, panel, handle);
  document.body.appendChild(canvas);
  return { canvas, viewport, node };
}

beforeEach(() => {
  hoisted.canvas = {
    toBlob: (cb: BlobCallback) => cb(new Blob(["png-bytes"], { type: "image/png" })),
  };
  domToCanvasMock.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("captureErdPng", () => {
  it("AC1 + AC2: ảnh sát biên sơ đồ, không viền thừa, 2x, không nút điều khiển/minimap", async () => {
    const { viewport } = mountDiagram({ width: 1200, height: 700 });
    const steps: string[] = [];

    const blob = await captureErdPng({ onProgress: (s) => steps.push(s) });

    expect(blob).toBeInstanceOf(Blob);
    expect(steps).toEqual(["prepare", "capture", "encode"]);
    expect(domToCanvasMock).toHaveBeenCalledTimes(1);
    const [node, options] = captureCalls()[0];
    expect(node.className).toContain("react-flow__viewport");
    expect(node).not.toBe(viewport); // chụp bản sao, không đụng vào sơ đồ thật
    expect(options?.scale).toBe(2);
    // Biên thế giới: x 40..500, y 60..180 → cộng lề 24 mỗi bên.
    expect(options?.width).toBe(460 + 48);
    expect(options?.height).toBe(120 + 48);
    // Khung nhìn của người dùng (pan/zoom) không vào ảnh: đưa biên về gốc, tỉ lệ 1.
    // Thẻ trái nhất ở x=40 → dịch −16 để mép trái cách lề 24; y=60 → −36.
    expect((node as HTMLElement).style.transform).toBe("translate(-16px, -36px) scale(1)");
    expect(node.querySelector(".react-flow__minimap")).toBeNull();
    expect(node.querySelector(".react-flow__controls")).toBeNull();
    expect(node.querySelector(".react-flow__handle")).toBeNull();
  });

  it("AC4: tab sơ đồ đang ẩn (mọi phép đo bằng 0) ra đúng ảnh như tab đang hiện, không trắng", async () => {
    mountDiagram({ width: 1200, height: 700 });
    await captureErdPng();
    const [, visible] = captureCalls()[0];

    // Cùng sơ đồ nhưng khung canvas bị ẩn: che bằng tab khác (0×0).
    document.body.innerHTML = "";
    domToCanvasMock.mockClear();
    mountDiagram({ width: 0, height: 0 });
    await captureErdPng();
    const [, hidden] = captureCalls()[0];

    expect([hidden?.width, hidden?.height]).toEqual([visible?.width, visible?.height]);
    expect(hidden?.backgroundColor).toBeTruthy(); // không nền trong suốt, dán vào tài liệu vẫn đọc được
  });

  it("AC4: mở layout tạm thời cho tab ẩn để React Flow trả lại đường nối, rồi trả nguyên trạng", async () => {
    // Giả lập đúng hành vi thật: container ẩn → đo 0 px và edge bị xoá; hiện → có kích thước và edge quay lại.
    const { canvas, viewport } = mountDiagram({ width: 0, height: 0 });
    // Như tab của Radix: một lớp bọc bên ngoài bị `display: none`.
    const wrapper = document.createElement("div");
    wrapper.style.display = "none";
    document.body.appendChild(wrapper);
    wrapper.appendChild(canvas);
    const sync = () => {
      const shown = wrapper.style.display !== "none";
      canvas.getBoundingClientRect = () =>
        ({ width: shown ? 1200 : 0, height: shown ? 700 : 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      viewport.querySelectorAll(".react-flow__edge").forEach((n) => n.remove());
      if (shown) {
        const edge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        edge.setAttribute("class", "react-flow__edge");
        viewport.appendChild(edge);
      }
    };
    sync();
    new MutationObserver(sync).observe(wrapper, { attributes: true, attributeFilter: ["style"] });

    await captureErdPng();

    const [node] = captureCalls()[0];
    expect(node.querySelector(".react-flow__edge")).not.toBeNull(); // đường nối không bị mất
    // Trả lại đúng trạng thái ẩn của tab, không để lại style nào.
    expect(wrapper.style.display).toBe("none");
    expect(wrapper.style.visibility).toBe("");
  });

  it("AC4: chờ layout ổn định — không chụp lúc sơ đồ còn dồn thành một cột", async () => {
    const { canvas, viewport } = mountDiagram({ width: 0, height: 0 });
    const wrapper = document.createElement("div");
    wrapper.style.display = "none";
    document.body.appendChild(wrapper);
    wrapper.appendChild(canvas);

    // Lúc còn ẩn, React Flow dồn hai thẻ thành một cột dọc.
    const nodes = [...viewport.querySelectorAll<HTMLElement>(".react-flow__node")];
    nodes[0].style.transform = "translate(40px, 0px)";
    nodes[1].style.transform = "translate(40px, 240px)";

    let settled = false;
    const observer = new MutationObserver(() => {
      if (wrapper.style.display === "none" || settled) return;
      settled = true;
      canvas.getBoundingClientRect = () =>
        ({ width: 1200, height: 700, top: 0, left: 0, right: 1200, bottom: 700, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      // React Flow tính lại vị trí ở nhịp render sau: bố cục 2 chiều mới là bố cục thật.
      setTimeout(() => {
        nodes[0].style.transform = "translate(40px, 60px)";
        nodes[1].style.transform = "translate(300px, 60px)";
        const edge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        edge.setAttribute("class", "react-flow__edge");
        viewport.appendChild(edge);
      }, 48);
    });
    observer.observe(wrapper, { attributes: true, attributeFilter: ["style"] });

    await captureErdPng();
    observer.disconnect();

    const [, options] = captureCalls()[0];
    // Biên của bố cục 2 chiều (460×120 + lề), không phải của cột dọc (200×360 + lề).
    expect([options?.width, options?.height]).toEqual([460 + 48, 120 + 48]);
  });

  it("sơ đồ chưa có thẻ nào (chưa vẽ xong) thì lui về khung canvas đang thấy", async () => {
    const { viewport } = mountDiagram({ width: 900, height: 500 });
    viewport.querySelectorAll(".react-flow__node").forEach((n) => n.remove());

    await captureErdPng();

    const [, options] = captureCalls()[0];
    expect([options?.width, options?.height]).toEqual([900, 500]);
  });

  it("ép kích thước qua options được ưu tiên hơn phép đo", async () => {
    mountDiagram({ width: 1200, height: 700 });
    await captureErdPng({ width: 640, height: 480 });
    const [, options] = captureCalls()[0];
    expect([options?.width, options?.height]).toEqual([640, 480]);
  });

  it("chưa có sơ đồ thì báo not_found và không gọi thư viện chụp", async () => {
    await expect(captureErdPng()).rejects.toMatchObject({ code: "not_found" });
    expect(domToCanvasMock).not.toHaveBeenCalled();
  });

  it("nén ảnh thất bại thì ném failed và dọn khung off-screen", async () => {
    mountDiagram();
    hoisted.canvas = { toBlob: (cb: BlobCallback) => cb(null) };

    await expect(captureErdPng()).rejects.toBeInstanceOf(ErdCaptureError);
    await expect(captureErdPng()).rejects.toMatchObject({ code: "failed" });
    expect(document.querySelector("[data-erd-capture-host]")).toBeNull();
  });

  it("AC6: không phát sinh request mạng nào khi xuất ảnh", async () => {
    mountDiagram();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await captureErdPng();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("khung off-screen luôn bị dọn sau khi chụp xong", async () => {
    mountDiagram();
    await captureErdPng();
    expect(document.querySelector("[data-erd-capture-host]")).toBeNull();
  });
});

describe("planScale", () => {
  it("AC2: sơ đồ vừa khung thì giữ đúng 2x", () => {
    expect(planScale(1000, 600)).toBe(2);
  });

  it("sơ đồ quá rộng thì hạ độ nét thay vì cắt bớt bảng", () => {
    // 16.000 px CSS ở 2x là 32.000 px, vượt cạnh tối đa của canvas → hạ xuống 1.02x.
    expect(planScale(16_000, 600)).toBe(1.02);
  });

  it("vượt giới hạn ngay cả ở 1x thì từ chối kèm mã too_large, không trả ảnh cắt cụt", () => {
    try {
      planScale(20_000, 20_000);
      expect.unreachable("phải ném ErdCaptureError");
    } catch (e) {
      expect(e).toBeInstanceOf(ErdCaptureError);
      expect(e).toMatchObject({ code: "too_large" });
    }
  });
});

describe("pruneCaptureClone", () => {
  it("bỏ minimap, controls, panel, attribution và handle nhưng giữ thẻ bảng", () => {
    const { viewport } = mountDiagram();
    const clone = viewport.cloneNode(true) as HTMLElement;
    for (const cls of ["minimap", "controls", "panel", "attribution", "handle"]) {
      const el = document.createElement("div");
      el.className = `react-flow__${cls}`;
      clone.appendChild(el);
    }

    pruneCaptureClone(clone);

    expect(clone.querySelector('[class*="react-flow__minimap"]')).toBeNull();
    expect(clone.querySelector('[class*="react-flow__controls"]')).toBeNull();
    expect(clone.querySelector('[class*="react-flow__panel"]')).toBeNull();
    expect(clone.querySelector('[class*="react-flow__attribution"]')).toBeNull();
    expect(clone.querySelector('[class*="react-flow__handle"]')).toBeNull();
    expect(clone.querySelector(".react-flow__node")).not.toBeNull();
  });
});
