# Task008: Hợp đồng chung

Thuộc: SP001 / STR004
Mục tiêu: Khóa các kiểu dữ liệu mà mọi module dựa vào, để kết luận thiếu nhãn không compile được.
Phạm vi: `web/src/contracts/**`.
Không làm: component hiển thị nhãn, adapter thật, code Go (Task009 làm phía Go theo cùng định dạng lỗi).

Hợp đồng:

```ts
// web/src/contracts/conclusion.ts
export type EvidenceLabel = "real" | "simulated" | "estimated";
export type Evidence = { kind: string; messageKey: string; values?: Record<string, string | number> };
export type Conclusion<T> = {
  kind: "conclusion";
  label: EvidenceLabel;
  data: T;
  evidence: [Evidence, ...Evidence[]];
};
export type NotSimulated = { kind: "not_simulated"; reasonKey: string };
export type Outcome<T> = Conclusion<T> | NotSimulated;

// web/src/contracts/engine.ts
export type EngineId = "postgres" | "mysql";
export type QueryResult = { columns: string[]; rows: unknown[][]; affectedRows?: number };
export interface EngineAdapter {
  readonly engine: EngineId;
  execute(sql: string, options?: { signal?: AbortSignal }): Promise<QueryResult[]>;
  explain(sql: string, options?: { signal?: AbortSignal }): Promise<Outcome<unknown>>;
  dispose(): Promise<void>;
}

// web/src/contracts/api-error.ts
export type ApiError = { error: { code: string; messageKey: string } };
```

Có thể chỉnh chi tiết nếu TypeScript buộc phải chỉnh, nhưng phải ghi vào bàn giao. Câu chữ hiển thị không nằm trong kiểu dữ liệu, chỉ có `messageKey` và `reasonKey`, vì giao diện có hai ngôn ngữ.

Tiêu chí xong:
- AC1: Tạo `Conclusion` thiếu `label`: lỗi compile. Kiểm bằng `@ts-expect-error` trong file test và chạy `npm run typecheck`.
- AC2: `label` nằm ngoài ba giá trị: lỗi compile.
- AC3: `evidence` là mảng rỗng: lỗi compile.
- AC4: `Conclusion` mang hai nhãn dạng mảng: lỗi compile.
- AC5: `switch` trên `Outcome<T>` có nhánh `never` compile được khi đủ hai trường hợp.
- AC6: Hàm `isApiError(value: unknown): value is ApiError` có test cho đúng dạng, thiếu trường, `null`.
- AC7: `npm run check` thoát với mã 0.

Ca biên: `ApiError` không có trường chứa SQL hay nội dung người dùng gửi lên. Gin đã trả đúng định dạng này ở Task009, với `code` là `not_found`, `method_not_allowed`, `payload_too_large`, `internal`, nên không được đổi tên trường.
Kiểm tra: `cd web && npm run check`
Góc review thêm: nhãn kết luận.
Đọc thêm: `CLAUDE.md` mục "Nguyên tắc không được phá"; bàn giao Task001.
