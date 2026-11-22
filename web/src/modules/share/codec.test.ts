import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SnapshotV1,
  SnapshotError,
  SNAPSHOT_HARD_LIMIT_BYTES,
  SNAPSHOT_WARN_LIMIT_BYTES,
  MAX_SNAPSHOT_TABS,
  isSnapshotWarnSize,
  snapshotTabLimitExceeded,
  validateSnapshotStructure,
} from "./snapshot";
import {
  encodeSnapshot,
  decodeSnapshot,
  canonicalJsonStringify,
  bytesToBase64Url,
  base64UrlToBytes,
} from "./codec";

describe("Snapshot Codec (Task 143)", () => {
  const sampleSnapshot: SnapshotV1 = {
    v: 1,
    project: {
      name: "E-Commerce Analytics",
      engine: "postgres",
    },
    tabs: [
      {
        name: "01_schema.sql",
        sql: "CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT NOW());",
      },
      {
        name: "02_queries.sql",
        sql: "SELECT id, email FROM users WHERE created_at > NOW() - INTERVAL '7 days';",
      },
    ],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AC1: Round-trip decode(encode(s)) == s, kể cả SQL lớn 200KB", () => {
    it("giải mã snapshot tiêu chuẩn ra dữ liệu khớp 100%", async () => {
      const encoded = await encodeSnapshot(sampleSnapshot);
      expect(typeof encoded).toBe("string");
      expect(encoded.startsWith("g.")).toBe(true);

      // Chuỗi base64url sau tiền tố không được chứa +, /, =
      const b64Part = encoded.slice(2);
      expect(b64Part).not.toContain("+");
      expect(b64Part).not.toContain("/");
      expect(b64Part).not.toContain("=");

      const decoded = await decodeSnapshot(encoded);
      expect(decoded).toEqual(sampleSnapshot);
    });

    it("nén và phục hồi chính xác snapshot có tab SQL lớn 200KB dưới ngưỡng 32KB", async () => {
      // Dựng câu lệnh SQL lặp thực tế đạt ~200KB
      const ddl = "CREATE TABLE large_catalog (id INT PRIMARY KEY, name VARCHAR(100), price NUMERIC, description TEXT);\n";
      const insertTemplate = "INSERT INTO large_catalog (id, name, price, description) VALUES (1, 'Product Item', 99.99, 'Standard product description with repetitive metadata attributes for e-commerce catalog storage');\n";
      const repetitions = Math.ceil((200 * 1024) / insertTemplate.length);
      const largeSql = ddl + insertTemplate.repeat(repetitions);

      expect(largeSql.length).toBeGreaterThanOrEqual(200 * 1024);

      const largeSnapshot: SnapshotV1 = {
        v: 1,
        project: {
          name: "Large Scale Catalog",
          engine: "postgres",
        },
        tabs: [
          {
            name: "heavy_migration.sql",
            sql: largeSql,
          },
        ],
      };

      const encoded = await encodeSnapshot(largeSnapshot);

      // Nén gzip văn bản SQL 200KB phải xuống rất sâu, nhỏ hơn nhiều so với giới hạn cứng 32KB
      expect(encoded.length).toBeLessThan(SNAPSHOT_HARD_LIMIT_BYTES);

      const decoded = await decodeSnapshot(encoded);
      expect(decoded.v).toBe(1);
      expect(decoded.project).toEqual(largeSnapshot.project);
      expect(decoded.tabs).toHaveLength(1);
      expect(decoded.tabs[0].name).toBe("heavy_migration.sql");
      expect(decoded.tabs[0].sql).toBe(largeSql);
      expect(decoded.tabs[0].sql.length).toBe(largeSql.length);
    });
  });

  describe("AC2: Tính tất định (Deterministic)", () => {
    it("chạy 10 lần liên tiếp cùng snapshot cho ra đúng 100% cùng chuỗi URL fragment", async () => {
      const firstEncoded = await encodeSnapshot(sampleSnapshot);

      for (let i = 0; i < 10; i++) {
        const currentEncoded = await encodeSnapshot(sampleSnapshot);
        expect(currentEncoded).toBe(firstEncoded);
      }
    });

    it("xáo trộn thứ tự các thuộc tính đối tượng vẫn cho ra cùng một chuỗi mã hóa", async () => {
      // Đối tượng 1: thứ tự project -> tabs -> v
      const objA: SnapshotV1 = {
        project: { engine: "mysql", name: "ShopDB" },
        tabs: [
          { sql: "SELECT 1;", name: "Tab A" },
          { name: "Tab B", sql: "SELECT 2;" },
        ],
        v: 1,
      };

      // Đối tượng 2: thứ tự v -> tabs -> project, trong project name trước engine
      const objB: SnapshotV1 = {
        v: 1,
        tabs: [
          { name: "Tab A", sql: "SELECT 1;" },
          { sql: "SELECT 2;", name: "Tab B" },
        ],
        project: { name: "ShopDB", engine: "mysql" },
      };

      const encodedA = await encodeSnapshot(objA);
      const encodedB = await encodeSnapshot(objB);

      expect(encodedA).toBe(encodedB);
    });

    it("canonicalJsonStringify sắp xếp key alphabet ở mọi cấp lồng nhau", () => {
      const raw1 = { z: 1, a: 2, m: { y: 10, x: 20 } };
      const raw2 = { a: 2, m: { x: 20, y: 10 }, z: 1 };

      expect(canonicalJsonStringify(raw1)).toBe(canonicalJsonStringify(raw2));
      expect(canonicalJsonStringify(raw1)).toBe('{"a":2,"m":{"x":20,"y":10},"z":1}');
    });
  });

  describe("AC3: Kiểm soát trần kích thước và ngưỡng cảnh báo", () => {
    it("chuỗi vượt 32KB ném SNAPSHOT_TOO_LARGE khi encode", async () => {
      // Dữ liệu ngẫu nhiên không thể nén bằng gzip để vượt ngưỡng 32KB
      // Sử dụng chuỗi ký tự ngẫu nhiên entropy cao
      let highEntropySql = "";
      for (let i = 0; i < 50000; i++) {
        highEntropySql += String.fromCharCode(32 + Math.floor(Math.random() * 95));
      }

      const hugeSnapshot: SnapshotV1 = {
        v: 1,
        project: {
          name: "Random Noise",
          engine: "sqlite",
        },
        tabs: [
          {
            name: "noise.sql",
            sql: highEntropySql,
          },
        ],
      };

      await expect(encodeSnapshot(hugeSnapshot)).rejects.toThrowError(SnapshotError);

      try {
        await encodeSnapshot(hugeSnapshot);
      } catch (err) {
        expect(err).toBeInstanceOf(SnapshotError);
        expect((err as SnapshotError).code).toBe("SNAPSHOT_TOO_LARGE");
        expect(((err as SnapshotError).details as { size: number }).size).toBeGreaterThan(
          SNAPSHOT_HARD_LIMIT_BYTES
        );
      }
    });

    it("chuỗi payload vượt 32KB ném SNAPSHOT_TOO_LARGE khi decode", async () => {
      const oversizedPayload = "g." + "A".repeat(SNAPSHOT_HARD_LIMIT_BYTES + 10);

      await expect(decodeSnapshot(oversizedPayload)).rejects.toThrowError(SnapshotError);

      try {
        await decodeSnapshot(oversizedPayload);
      } catch (err) {
        expect(err).toBeInstanceOf(SnapshotError);
        expect((err as SnapshotError).code).toBe("SNAPSHOT_TOO_LARGE");
      }
    });

    it("isSnapshotWarnSize trả false khi < 8KB và true khi >= 8KB", () => {
      const underWarn = "g." + "A".repeat(SNAPSHOT_WARN_LIMIT_BYTES - 10);
      const exactWarn = "g." + "A".repeat(SNAPSHOT_WARN_LIMIT_BYTES - 2); // cộng 'g.' = 8192
      const overWarn = "g." + "A".repeat(SNAPSHOT_WARN_LIMIT_BYTES + 100);

      expect(isSnapshotWarnSize(underWarn)).toBe(false);
      expect(isSnapshotWarnSize(exactWarn)).toBe(true);
      expect(isSnapshotWarnSize(overWarn)).toBe(true);
      expect(isSnapshotWarnSize("")).toBe(false);
      expect(isSnapshotWarnSize(null as unknown as string)).toBe(false);
    });
  });

  describe("AC4: Bẫy lỗi chuỗi hỏng, cắt cụt và sai version", () => {
    it("payload rỗng hoặc chỉ có whitespace ném SNAPSHOT_CORRUPT", async () => {
      await expect(decodeSnapshot("")).rejects.toThrowError(SnapshotError);
      await expect(decodeSnapshot("   ")).rejects.toThrowError(SnapshotError);

      try {
        await decodeSnapshot("");
      } catch (err) {
        expect((err as SnapshotError).code).toBe("SNAPSHOT_CORRUPT");
      }
    });

    it("payload có ký tự base64url không hợp lệ ném SNAPSHOT_CORRUPT", async () => {
      const corruptPayload = "g.invalid!@#$characters%";

      try {
        await decodeSnapshot(corruptPayload);
        expect.unreachable("Phải ném SNAPSHOT_CORRUPT");
      } catch (err) {
        expect(err).toBeInstanceOf(SnapshotError);
        expect((err as SnapshotError).code).toBe("SNAPSHOT_CORRUPT");
      }
    });

    it("payload base64url có độ dài mod 4 === 1 ném SNAPSHOT_CORRUPT", async () => {
      const invalidLenPayload = "g.abcde"; // 5 ký tự -> mod 4 === 1

      try {
        await decodeSnapshot(invalidLenPayload);
        expect.unreachable("Phải ném SNAPSHOT_CORRUPT");
      } catch (err) {
        expect(err).toBeInstanceOf(SnapshotError);
        expect((err as SnapshotError).code).toBe("SNAPSHOT_CORRUPT");
      }
    });

    it("payload gzip bị cắt cụt (truncated) ném SNAPSHOT_CORRUPT", async () => {
      const valid = await encodeSnapshot(sampleSnapshot);
      // Cắt cụt một nửa chuỗi base64
      const truncated = valid.slice(0, Math.floor(valid.length / 2));

      try {
        await decodeSnapshot(truncated);
        expect.unreachable("Phải ném SNAPSHOT_CORRUPT");
      } catch (err) {
        expect(err).toBeInstanceOf(SnapshotError);
        expect((err as SnapshotError).code).toBe("SNAPSHOT_CORRUPT");
      }
    });

    it("payload chỉ có tiền tố mà không có dữ liệu ném SNAPSHOT_CORRUPT", async () => {
      try {
        await decodeSnapshot("g.");
        expect.unreachable("Phải ném SNAPSHOT_CORRUPT");
      } catch (err) {
        expect(err).toBeInstanceOf(SnapshotError);
        expect((err as SnapshotError).code).toBe("SNAPSHOT_CORRUPT");
      }
    });

    it("snapshot có version v: 2 ném SNAPSHOT_VERSION_UNSUPPORTED", async () => {
      const v2Snapshot = {
        v: 2,
        project: { name: "V2 Project", engine: "postgres" },
        tabs: [{ name: "Tab 1", sql: "SELECT 2;" }],
      };

      // Khi encode đối tượng v: 2
      await expect(encodeSnapshot(v2Snapshot as unknown as SnapshotV1)).rejects.toThrowError(
        SnapshotError
      );
      try {
        await encodeSnapshot(v2Snapshot as unknown as SnapshotV1);
      } catch (err) {
        expect((err as SnapshotError).code).toBe("SNAPSHOT_VERSION_UNSUPPORTED");
      }

      // Giả lập chuỗi được nén từ JSON có v: 2 và gọi decodeSnapshot
      const jsonV2 = JSON.stringify(v2Snapshot);
      const b64 = bytesToBase64Url(new TextEncoder().encode(jsonV2));
      const uncompressedPayload = "u." + b64;

      try {
        await decodeSnapshot(uncompressedPayload);
        expect.unreachable("Phải ném SNAPSHOT_VERSION_UNSUPPORTED");
      } catch (err) {
        expect(err).toBeInstanceOf(SnapshotError);
        expect((err as SnapshotError).code).toBe("SNAPSHOT_VERSION_UNSUPPORTED");
        expect(((err as SnapshotError).details as { version: number }).version).toBe(2);
      }
    });

    it("snapshot thiếu các trường bắt buộc hoặc sai kiểu ném SNAPSHOT_CORRUPT", async () => {
      const invalidCandidates = [
        { v: 1 }, // Thiếu project và tabs
        { v: 1, project: null, tabs: [] },
        { v: 1, project: { name: 123, engine: "postgres" }, tabs: [] }, // name không phải string
        { v: 1, project: { name: "P", engine: "oracle" }, tabs: [] }, // engine không hợp lệ
        { v: 1, project: { name: "P", engine: "postgres" }, tabs: null }, // tabs không phải array
        { v: 1, project: { name: "P", engine: "postgres" }, tabs: [{ name: "t1" }] }, // tab thiếu sql
      ];

      for (const invalid of invalidCandidates) {
        const json = JSON.stringify(invalid);
        const payload = "u." + bytesToBase64Url(new TextEncoder().encode(json));

        try {
          await decodeSnapshot(payload);
          expect.unreachable(`Phải ném SNAPSHOT_CORRUPT cho: ${json}`);
        } catch (err) {
          expect(err).toBeInstanceOf(SnapshotError);
          expect((err as SnapshotError).code).toBe("SNAPSHOT_CORRUPT");
        }
      }
    });
  });

  describe("AC5: Chế độ Fallback khi không có CompressionStream", () => {
    it("hoạt động bình thường khi CompressionStream là undefined và giải mã ngược lại đúng 100%", async () => {
      const originalCompressionStream = globalThis.CompressionStream;

      try {
        // Giả lập môi trường không hỗ trợ CompressionStream
        // @ts-expect-error Mocking missing CompressionStream
        globalThis.CompressionStream = undefined;

        const encoded = await encodeSnapshot(sampleSnapshot);

        // Fallback phải tạo tiền tố 'u.' (uncompressed)
        expect(encoded.startsWith("u.")).toBe(true);

        // Giải mã thành công dữ liệu gốc
        const decoded = await decodeSnapshot(encoded);
        expect(decoded).toEqual(sampleSnapshot);
      } finally {
        globalThis.CompressionStream = originalCompressionStream;
      }
    });

    it("giải mã đúng payload có tiền tố n0. và n1.", async () => {
      const jsonStr = canonicalJsonStringify(sampleSnapshot);
      const b64 = bytesToBase64Url(new TextEncoder().encode(jsonStr));

      // n0. là uncompressed
      const n0Payload = "n0." + b64;
      const decodedN0 = await decodeSnapshot(n0Payload);
      expect(decodedN0).toEqual(sampleSnapshot);

      // n1. là gzip
      const gzipEncoded = await encodeSnapshot(sampleSnapshot);
      const n1Payload = "n1." + gzipEncoded.slice(2);
      const decodedN1 = await decodeSnapshot(n1Payload);
      expect(decodedN1).toEqual(sampleSnapshot);
    });

    it("giải mã đúng payload raw base64url không có tiền tố (tự động nhận diện magic bytes)", async () => {
      // 1. Raw gzip base64url
      const gzipEncoded = await encodeSnapshot(sampleSnapshot);
      const rawGzipB64 = gzipEncoded.slice(2);
      const decodedRawGzip = await decodeSnapshot(rawGzipB64);
      expect(decodedRawGzip).toEqual(sampleSnapshot);

      // 2. Raw uncompressed base64url
      const jsonStr = canonicalJsonStringify(sampleSnapshot);
      const rawJsonB64 = bytesToBase64Url(new TextEncoder().encode(jsonStr));
      const decodedRawJson = await decodeSnapshot(rawJsonB64);
      expect(decodedRawJson).toEqual(sampleSnapshot);
    });
  });

  describe("Ca biên & Đa dạng dữ liệu (Edge Cases)", () => {
    it("xử lý hoàn hảo snapshot có 100 tabs", async () => {
      const tabs = Array.from({ length: 100 }, (_, i) => ({
        name: `tab_${String(i).padStart(3, "0")}.sql`,
        sql: `-- Tab ${i}\nSELECT ${i} AS tab_index, 'test_val_${i}' AS val;`,
      }));

      const snapshot100: SnapshotV1 = {
        v: 1,
        project: {
          name: "100 Tabs Project",
          engine: "sqlite",
        },
        tabs,
      };

      const encoded = await encodeSnapshot(snapshot100);
      expect(encoded.length).toBeLessThan(SNAPSHOT_HARD_LIMIT_BYTES);

      const decoded = await decodeSnapshot(encoded);
      expect(decoded.tabs).toHaveLength(100);
      expect(decoded.tabs[42].name).toBe("tab_042.sql");
      expect(decoded.tabs[42].sql).toContain("SELECT 42 AS tab_index");
    });

    it("xử lý tab chỉ có khoảng trắng hoặc rỗng", async () => {
      const whitespaceSnapshot: SnapshotV1 = {
        v: 1,
        project: {
          name: "Whitespace & Empty Tabs",
          engine: "mysql",
        },
        tabs: [
          { name: "empty.sql", sql: "" },
          { name: "spaces.sql", sql: "    \t\n   " },
        ],
      };

      const encoded = await encodeSnapshot(whitespaceSnapshot);
      const decoded = await decodeSnapshot(encoded);

      expect(decoded.tabs[0].sql).toBe("");
      expect(decoded.tabs[1].sql).toBe("    \t\n   ");
    });

    it("xử lý ký tự Unicode tiếng Việt có dấu và Emoji đa byte trong tên tab & SQL", async () => {
      const unicodeSnapshot: SnapshotV1 = {
        v: 1,
        project: {
          name: "Dự án Tiếng Việt 🇻🇳",
          engine: "postgres",
        },
        tabs: [
          {
            name: "01_Khởi_tạo_bảng_🚀.sql",
            sql: `-- Cà phê sữa đá & Bánh mì Sài Gòn 🥖☕\nSELECT '🎉 Thành công rực rỡ!' AS kết_quả;\n-- Ký tự đặc biệt: « » “ ” — §`,
          },
          {
            name: "02_Truy_vấn_lửa_🔥.sql",
            sql: `SELECT 'Hỏa tốc' AS speed, '👨‍💻' AS dev;`,
          },
        ],
      };

      const encoded = await encodeSnapshot(unicodeSnapshot);
      const decoded = await decodeSnapshot(encoded);

      expect(decoded).toEqual(unicodeSnapshot);
      expect(decoded.project.name).toBe("Dự án Tiếng Việt 🇻🇳");
      expect(decoded.tabs[0].name).toBe("01_Khởi_tạo_bảng_🚀.sql");
      expect(decoded.tabs[0].sql).toContain("Cà phê sữa đá & Bánh mì Sài Gòn 🥖☕");
      expect(decoded.tabs[1].sql).toContain("👨‍💻");
    });

    it("validateSnapshotStructure nhận diện đúng đối tượng hợp lệ và không hợp lệ", () => {
      expect(validateSnapshotStructure(sampleSnapshot)).toBe(true);

      expect(validateSnapshotStructure(null)).toBe(false);
      expect(validateSnapshotStructure(undefined)).toBe(false);
      expect(validateSnapshotStructure("string")).toBe(false);
      expect(validateSnapshotStructure(123)).toBe(false);
      expect(validateSnapshotStructure({})).toBe(false);
      expect(validateSnapshotStructure({ v: 2 })).toBe(false);
      expect(validateSnapshotStructure({ v: 1, project: { name: "P", engine: "invalid" }, tabs: [] })).toBe(false);
      expect(validateSnapshotStructure({ v: 1, project: { name: "P", engine: "sqlite" }, tabs: [{ name: 1, sql: "SELECT 1" }] })).toBe(false);
    });

    it("bytesToBase64Url và base64UrlToBytes chuyển đổi chính xác mảng byte", () => {
      const testBytes = new Uint8Array([0, 1, 2, 255, 254, 128, 64, 32]);
      const b64url = bytesToBase64Url(testBytes);
      expect(b64url).not.toContain("+");
      expect(b64url).not.toContain("/");
      expect(b64url).not.toContain("=");

      const recovered = base64UrlToBytes(b64url);
      expect(Array.from(recovered)).toEqual(Array.from(testBytes));
    });
  });

  // SP999 (phát hiện mức thấp của cổng bảo mật Task155): link 32 KB vẫn nhét được cả nghìn tab,
  // bấm Fork là ghi hết vào IndexedDB của người nhận.
  describe("Trần số tab của snapshot", () => {
    const withTabs = (n: number): SnapshotV1 => ({
      v: 1,
      project: { name: "Nhiều tab", engine: "postgres" },
      tabs: Array.from({ length: n }, (_, i) => ({ name: `t${i}`, sql: "SELECT 1;" })),
    });

    it("đúng 100 tab vẫn hợp lệ, 101 tab bị coi là quá trần", () => {
      expect(MAX_SNAPSHOT_TABS).toBe(100);
      expect(validateSnapshotStructure(withTabs(MAX_SNAPSHOT_TABS))).toBe(true);
      expect(snapshotTabLimitExceeded(withTabs(MAX_SNAPSHOT_TABS))).toBe(false);
      expect(validateSnapshotStructure(withTabs(MAX_SNAPSHOT_TABS + 1))).toBe(false);
      expect(snapshotTabLimitExceeded(withTabs(MAX_SNAPSHOT_TABS + 1))).toBe(true);
    });

    it("giải mã link chứa 101 tab ném SNAPSHOT_TOO_MANY_TABS, không trả về snapshot", async () => {
      // Dựng tay payload không nén: encodeSnapshot đã chặn trước nên không dùng được để tạo mẫu xấu.
      const json = JSON.stringify(withTabs(MAX_SNAPSHOT_TABS + 1));
      const payload = "u." + bytesToBase64Url(new TextEncoder().encode(json));

      await expect(decodeSnapshot(payload)).rejects.toBeInstanceOf(SnapshotError);
      try {
        await decodeSnapshot(payload);
      } catch (err) {
        expect((err as SnapshotError).code).toBe("SNAPSHOT_TOO_MANY_TABS");
      }
    });

    it("mã hóa snapshot quá 100 tab bị chặn trước khi sinh link", async () => {
      await expect(encodeSnapshot(withTabs(MAX_SNAPSHOT_TABS + 1))).rejects.toBeInstanceOf(SnapshotError);
      try {
        await encodeSnapshot(withTabs(MAX_SNAPSHOT_TABS + 1));
      } catch (err) {
        expect((err as SnapshotError).code).toBe("SNAPSHOT_TOO_MANY_TABS");
      }
    });
  });
});
