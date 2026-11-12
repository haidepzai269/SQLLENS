import { CompletionContext, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { MySQL, PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  createSqlAutocompleteExtension,
  formatSchemaForCompletion,
} from "./dropdown-autocomplete";

describe("Dropdown Autocomplete Extension (Task108)", () => {
  const sampleSchema = {
    users: ["id", "username", "email", "created_at"],
    orders: ["order_id", "user_id", "total_price", "status"],
  };

  describe("AC1: Trạng thái tắt (enabled === false)", () => {
    it("trả về mảng extension rỗng [] khi enabled === false để đảm bảo zero CPU overhead", () => {
      const ext = createSqlAutocompleteExtension({
        schema: sampleSchema,
        dialect: PostgreSQL,
        enabled: false,
      });

      expect(Array.isArray(ext)).toBe(true);
      expect((ext as unknown[]).length).toBe(0);
    });
  });

  describe("AC2 & AC4: Ánh xạ schema và phân loại icon/detail", () => {
    it("formatSchemaForCompletion ánh xạ bảng thành class/table và cột thành property/column", () => {
      const { namespace, topColumns } = formatSchemaForCompletion(sampleSchema);

      // Kiểm tra cấu trúc namespace của bảng users
      const usersEntry = (namespace as Record<string, unknown>)["users"] as {
        self: { label: string; type: string; detail: string; boost?: number };
        children: Array<{ label: string; type: string; detail: string }>;
      };
      expect(usersEntry).toBeDefined();
      expect(usersEntry.self).toEqual({
        label: "users",
        type: "class",
        detail: "table",
        boost: 2,
      });

      expect(usersEntry.children).toHaveLength(4);
      expect(usersEntry.children[0]).toEqual({
        label: "id",
        type: "property",
        detail: "column",
        boost: 1,
      });
      expect(usersEntry.children[2]).toEqual({
        label: "email",
        type: "property",
        detail: "column",
        boost: 1,
      });

      // Kiểm tra topColumns đã deduplicate
      expect(topColumns.length).toBeGreaterThan(0);
      const emailCol = topColumns.find((c) => c.label === "email");
      expect(emailCol).toBeDefined();
      expect(emailCol?.type).toBe("property");
      expect(emailCol?.detail).toBe("column");
    });

    it("khi enabled === true: tạo extension hợp lệ chứa language data và autocompletion", () => {
      const ext = createSqlAutocompleteExtension({
        schema: sampleSchema,
        dialect: PostgreSQL,
        enabled: true,
      });

      expect(Array.isArray(ext)).toBe(true);
      expect((ext as unknown[]).length).toBe(3);
    });
  });

  describe("AC3 & AC5: Tương tác tìm kiếm gợi ý trên EditorState", () => {
    it("gợi ý chính xác danh sách cột sau dấu chấm 'users.' với type property và detail column", () => {
      const baseLang = sql({ dialect: PostgreSQL });
      const autocompleteExt = createSqlAutocompleteExtension({
        schema: sampleSchema,
        dialect: PostgreSQL,
        enabled: true,
      });

      const state = EditorState.create({
        doc: "SELECT users.",
        extensions: [baseLang, autocompleteExt],
      });

      const pos = "SELECT users.".length;
      const ctx = new CompletionContext(state, pos, true);
      const sources = state.languageDataAt("autocomplete", pos) as CompletionSource[];

      expect(sources.length).toBeGreaterThan(0);

      // Tìm source trả về options cho 'users.'
      let columnOptions: readonly Completion[] = [];
      for (const s of sources) {
        const res = s(ctx);
        if (res && "options" in res && res.options.some((o: Completion) => o.label === "username")) {
          columnOptions = res.options;
          break;
        }
      }

      expect(columnOptions).toHaveLength(4);
      expect(columnOptions.map((o) => o.label)).toEqual(["id", "username", "email", "created_at"]);
      expect(columnOptions[0]?.type).toBe("property");
      expect(columnOptions[0]?.detail).toBe("column");
    });

    it("gợi ý tên bảng ở top-level khi người dùng gõ ký tự đầu", () => {
      const baseLang = sql({ dialect: PostgreSQL });
      const autocompleteExt = createSqlAutocompleteExtension({
        schema: sampleSchema,
        dialect: PostgreSQL,
        enabled: true,
      });

      const state = EditorState.create({
        doc: "SELECT u",
        extensions: [baseLang, autocompleteExt],
      });

      const pos = "SELECT u".length;
      const ctx = new CompletionContext(state, pos, true);
      const sources = state.languageDataAt("autocomplete", pos) as CompletionSource[];

      let foundUsers = false;
      for (const s of sources) {
        const res = s(ctx);
        if (res && "options" in res && res.options.some((o: Completion) => o.label === "users" && o.type === "class")) {
          foundUsers = true;
          break;
        }
      }

      expect(foundUsers).toBe(true);
    });
  });

  describe("Ca biên (Edge cases)", () => {
    it("hoạt động ổn định khi schema rỗng {}", () => {
      const baseLang = sql({ dialect: PostgreSQL });
      const autocompleteExt = createSqlAutocompleteExtension({
        schema: {},
        dialect: PostgreSQL,
        enabled: true,
      });

      const state = EditorState.create({
        doc: "SELECT ",
        extensions: [baseLang, autocompleteExt],
      });

      const pos = "SELECT ".length;
      const ctx = new CompletionContext(state, pos, true);
      const sources = state.languageDataAt("autocomplete", pos) as CompletionSource[];

      expect(() => {
        for (const s of sources) {
          s(ctx);
        }
      }).not.toThrow();
    });

    it("xử lý an toàn bảng có tên hoa và ký tự đặc biệt", () => {
      const specialSchema = {
        "User_Profiles": ["User_ID", "FullName", "Email_Address"],
        '"User_Special$v2"': ["Col1", "Col2"],
      };

      const { namespace } = formatSchemaForCompletion(specialSchema);
      const entry = (namespace as Record<string, unknown>)["User_Profiles"] as {
        self: { label: string };
        children: Array<{ label: string }>;
      };

      expect(entry).toBeDefined();
      expect(entry.self.label).toBe("User_Profiles");
      expect(entry.children.map((c) => c.label)).toEqual(["User_ID", "FullName", "Email_Address"]);

      const autocompleteExt = createSqlAutocompleteExtension({
        schema: specialSchema,
        dialect: PostgreSQL,
        enabled: true,
      });

      const state = EditorState.create({
        doc: "SELECT User_Profiles.",
        extensions: [sql({ dialect: PostgreSQL }), autocompleteExt],
      });

      const pos = "SELECT User_Profiles.".length;
      const ctx = new CompletionContext(state, pos, true);
      const sources = state.languageDataAt("autocomplete", pos) as CompletionSource[];

      let found = false;
      for (const s of sources) {
        const res = s(ctx);
        if (res && "options" in res && res.options.some((o: Completion) => o.label === "User_ID")) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("chuyển đổi mượt mà sang MySQL dialect", () => {
      const mysqlExt = createSqlAutocompleteExtension({
        schema: sampleSchema,
        dialect: MySQL,
        enabled: true,
      });

      const state = EditorState.create({
        doc: "SELECT `users`.",
        extensions: [sql({ dialect: MySQL }), mysqlExt],
      });

      const pos = "SELECT `users`.".length;
      const ctx = new CompletionContext(state, pos, true);
      const sources = state.languageDataAt("autocomplete", pos) as CompletionSource[];

      expect(sources.length).toBeGreaterThan(0);
      expect(() => {
        for (const s of sources) s(ctx);
      }).not.toThrow();
    });
  });
});
