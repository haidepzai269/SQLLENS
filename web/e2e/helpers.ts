import * as zlib from "node:zlib";
import { expect, type Page } from "@playwright/test";

// CPU_THROTTLE=4 làm chậm CPU 4 lần để tái hiện máy CI yếu. Gọi trong beforeEach.
export async function throttleCpu(page: Page) {
  const rate = Number(process.env.CPU_THROTTLE ?? 1);
  if (rate > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate });
}

// ShellProvider đặt data-hydrated trên <html> sau khi React gắn sự kiện. Bấm hay chọn trước lúc đó thì sự kiện mất,
// hoặc React đặt lại giá trị về state ban đầu.
export async function gotoHydrated(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
}

export async function reloadHydrated(page: Page) {
  await page.reload();
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
}

export interface ParsedPdfPage {
  pageNumber: number;
  text: string;
}

export interface ParsedPdf {
  pageCount: number;
  pages: ParsedPdfPage[];
  fullText: string;
}

/**
 * Phân tích CMap ToUnicode từ một stream PDF của Chromium Skia
 */
function parseCMap(cmapStr: string): Map<string, string> {
  const map = new Map<string, string>();

  // 1. beginbfchar ... endbfchar
  const bfCharBlocks = cmapStr.matchAll(/(\d+)\s+beginbfchar([\s\S]*?)endbfchar/g);
  for (const block of bfCharBlocks) {
    const lines = block[2].trim().split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/);
      if (match) {
        const cid = match[1].toLowerCase().padStart(4, "0");
        const utf16Hex = match[2];
        let char = "";
        for (let i = 0; i < utf16Hex.length; i += 4) {
          const code = parseInt(utf16Hex.slice(i, i + 4), 16);
          if (!isNaN(code)) char += String.fromCharCode(code);
        }
        map.set(cid, char);
      }
    }
  }

  // 2. beginbfrange ... endbfrange
  const bfRangeBlocks = cmapStr.matchAll(/(\d+)\s+beginbfrange([\s\S]*?)endbfrange/g);
  for (const block of bfRangeBlocks) {
    const lines = block[2].trim().split(/\r?\n/);
    for (const line of lines) {
      // Dạng 1: <startCID> <endCID> <startUnicode>
      const rangeMatch = line.match(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/);
      if (rangeMatch) {
        const startCid = parseInt(rangeMatch[1], 16);
        const endCid = parseInt(rangeMatch[2], 16);
        let startUni = parseInt(rangeMatch[3], 16);
        for (let c = startCid; c <= endCid; c++) {
          const cidHex = c.toString(16).toLowerCase().padStart(4, "0");
          map.set(cidHex, String.fromCharCode(startUni));
          startUni++;
        }
        continue;
      }

      // Dạng 2: <startCID> <endCID> [ <uni1> <uni2> ... ]
      const arrayMatch = line.match(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+\[([\s\S]*?)\]/);
      if (arrayMatch) {
        const startCid = parseInt(arrayMatch[1], 16);
        const hexList = arrayMatch[3].match(/<([0-9a-fA-F]+)>/g) || [];
        for (let i = 0; i < hexList.length; i++) {
          const cidHex = (startCid + i).toString(16).toLowerCase().padStart(4, "0");
          const utf16Hex = hexList[i].replace(/[<>]/g, "");
          let char = "";
          for (let j = 0; j < utf16Hex.length; j += 4) {
            const code = parseInt(utf16Hex.slice(j, j + 4), 16);
            if (!isNaN(code)) char += String.fromCharCode(code);
          }
          map.set(cidHex, char);
        }
      }
    }
  }

  return map;
}

/**
 * Trích xuất text từ một content stream dựa trên CMap
 */
function extractTextFromContentStream(
  content: string,
  fontMaps: Map<string, Map<string, string>>,
  fallbackMap: Map<string, string>,
): string {
  let activeFont = "";
  const textChunks: string[] = [];
  let lastY: number | null = null;

  // Bắt các toán tử trong content stream:
  // 1: /F1 12 Tf (chọn font)
  // 2: <hex> Tj
  // 3: [ ... ] TJ
  // 4: (literal) Tj
  // 5: Lệnh định vị tọa độ: a b c d e f Tm, dx dy Td / TD, T*
  const tokenRegex =
    /(\/F\w+)\s+[\d.]+\s+Tf|<([0-9a-fA-F]+)>\s*Tj|\[([\s\S]*?)\]\s*TJ|\(((?:[^\\)]|\\.)*)\)\s*Tj|((?:-?[\d.]+\s+){6}Tm|-?[\d.]+\s+-?[\d.]+\s+T[dD]|\bT\*)/g;
  let match;

  const pushChunk = (chunk: string) => {
    if (!chunk) return;
    textChunks.push(chunk);
  };

  const ensureSpace = () => {
    if (textChunks.length > 0 && !textChunks[textChunks.length - 1].endsWith(" ")) {
      textChunks.push(" ");
    }
  };

  while ((match = tokenRegex.exec(content)) !== null) {
    if (match[1]) {
      activeFont = match[1].slice(1);
    } else if (match[2]) {
      const hex = match[2];
      const currentCMap = fontMaps.get(activeFont) || fallbackMap;
      let text = "";
      for (let i = 0; i < hex.length; i += 4) {
        const cid = hex.slice(i, i + 4).toLowerCase().padStart(4, "0");
        text += currentCMap.get(cid) || "";
      }
      pushChunk(text);
    } else if (match[3]) {
      const tjContent = match[3];
      const currentCMap = fontMaps.get(activeFont) || fallbackMap;
      let text = "";
      const tjPartRegex = /<([0-9a-fA-F]+)>|(-?\d+(\.\d+)?)/g;
      let part;
      while ((part = tjPartRegex.exec(tjContent)) !== null) {
        if (part[1]) {
          const hex = part[1];
          for (let i = 0; i < hex.length; i += 4) {
            const cid = hex.slice(i, i + 4).toLowerCase().padStart(4, "0");
            text += currentCMap.get(cid) || "";
          }
        } else if (part[2]) {
          const spacing = parseFloat(part[2]);
          if (spacing < -180) {
            text += " ";
          }
        }
      }
      pushChunk(text);
    } else if (match[4]) {
      pushChunk(match[4]);
    } else if (match[5]) {
      const opStr = match[5].trim();
      if (opStr.endsWith("Tm")) {
        const parts = opStr.split(/\s+/);
        // [a, b, c, d, e, f, "Tm"], trong đó f là toạ độ Y
        const currentY = parseFloat(parts[5]);
        if (lastY !== null && Math.abs(currentY - lastY) > 3) {
          ensureSpace();
        }
        lastY = currentY;
      } else if (opStr.endsWith("Td") || opStr.endsWith("TD")) {
        const parts = opStr.split(/\s+/);
        // [dx, dy, "Td"], trong đó dy là dịch chuyển theo Y
        const dy = parseFloat(parts[1]);
        if (Math.abs(dy) > 3) {
          ensureSpace();
        }
      } else if (opStr === "T*") {
        ensureSpace();
      }
    }
  }

  return textChunks.join("").replace(/\s+/g, " ").trim();
}

/**
 * Parser PDF thuần Node.js không phụ thuộc thư viện ngoài:
 * Đọc PDF buffer sinh bởi Chromium Playwright, đếm chính xác số trang và trích xuất text từng trang.
 */
export function parsePdf(pdfBuffer: Buffer): ParsedPdf {
  const binaryStr = pdfBuffer.toString("binary");

  const objects = new Map<number, { header: string; streamBuffer?: Buffer; streamText?: string }>();
  const objRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let objMatch;

  while ((objMatch = objRegex.exec(binaryStr)) !== null) {
    const objId = parseInt(objMatch[1], 10);
    const body = objMatch[3];

    let streamBuffer: Buffer | undefined;
    let streamText: string | undefined;

    const streamStartMatch = body.match(/stream\r?\n/);
    if (streamStartMatch && streamStartMatch.index !== undefined) {
      const streamDataStart = streamStartMatch.index + streamStartMatch[0].length;
      const streamEndIndex = body.indexOf("endstream", streamDataStart);
      if (streamEndIndex !== -1) {
        let actualEnd = streamEndIndex;
        if (body[actualEnd - 1] === "\n") actualEnd--;
        if (body[actualEnd - 1] === "\r") actualEnd--;

        const rawStream = Buffer.from(body.slice(streamDataStart, actualEnd), "binary");

        if (body.includes("/Filter") && body.includes("/FlateDecode")) {
          try {
            streamBuffer = zlib.inflateSync(rawStream);
            streamText = streamBuffer.toString("utf-8");
          } catch {
            streamBuffer = rawStream;
            streamText = rawStream.toString("binary");
          }
        } else {
          streamBuffer = rawStream;
          streamText = rawStream.toString("utf-8");
        }
      }
    }

    objects.set(objId, {
      header: body,
      streamBuffer,
      streamText,
    });
  }

  const toUnicodeMaps = new Map<number, Map<string, string>>();
  const combinedCMap = new Map<string, string>();

  for (const [id, obj] of objects.entries()) {
    if (obj.streamText && (obj.streamText.includes("beginbfchar") || obj.streamText.includes("beginbfrange"))) {
      const cmap = parseCMap(obj.streamText);
      toUnicodeMaps.set(id, cmap);
      for (const [k, v] of cmap.entries()) {
        combinedCMap.set(k, v);
      }
    }
  }

  const pagesInfo: Array<{
    id: number;
    contentObjIds: number[];
    fontDict: Map<string, Map<string, string>>;
  }> = [];

  for (const [id, obj] of objects.entries()) {
    if (/\/Type\s*\/Page\b/.test(obj.header) && !/\/Type\s*\/Pages\b/.test(obj.header)) {
      const contentIds: number[] = [];
      const singleContentMatch = obj.header.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
      if (singleContentMatch) {
        contentIds.push(parseInt(singleContentMatch[1], 10));
      } else {
        const arrayContentMatch = obj.header.match(/\/Contents\s*\[([\s\S]*?)\]/);
        if (arrayContentMatch) {
          const refs = arrayContentMatch[1].matchAll(/(\d+)\s+\d+\s+R/g);
          for (const ref of refs) {
            contentIds.push(parseInt(ref[1], 10));
          }
        }
      }

      const pageFontMap = new Map<string, Map<string, string>>();
      const fontMatch = obj.header.match(/\/Font\s*<<([\s\S]*?)>>/);
      if (fontMatch) {
        const fontEntries = fontMatch[1].matchAll(/\/(\w+)\s+(\d+)\s+\d+\s+R/g);
        for (const fe of fontEntries) {
          const fontAlias = fe[1];
          const fontObjId = parseInt(fe[2], 10);
          const fontObj = objects.get(fontObjId);
          if (fontObj) {
            const tuMatch = fontObj.header.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
            if (tuMatch) {
              const tuId = parseInt(tuMatch[1], 10);
              const cmap = toUnicodeMaps.get(tuId);
              if (cmap) pageFontMap.set(fontAlias, cmap);
            }
          }
        }
      }

      pagesInfo.push({
        id,
        contentObjIds: contentIds,
        fontDict: pageFontMap,
      });
    }
  }

  const parsedPages: ParsedPdfPage[] = [];
  for (let i = 0; i < pagesInfo.length; i++) {
    const pInfo = pagesInfo[i];
    let pageText = "";

    for (const cId of pInfo.contentObjIds) {
      const cObj = objects.get(cId);
      if (cObj && cObj.streamText) {
        const extracted = extractTextFromContentStream(
          cObj.streamText,
          pInfo.fontDict,
          combinedCMap,
        );
        pageText += (pageText ? " " : "") + extracted;
      }
    }

    parsedPages.push({
      pageNumber: i + 1,
      text: pageText.replace(/\s+/g, " ").trim(),
    });
  }

  let pageCount = parsedPages.length;
  if (pageCount === 0) {
    const countMatch = binaryStr.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
    if (countMatch) {
      pageCount = parseInt(countMatch[1], 10);
    }
  }

  const fullText = parsedPages.map((p) => p.text).join("\n\n");

  return {
    pageCount,
    pages: parsedPages,
    fullText,
  };
}

