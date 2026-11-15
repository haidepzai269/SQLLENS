import type { EngineId } from "@/contracts/engine";

export type EngineType = EngineId | (string & {});

/**
 * Rào chắn an toàn kiểm soát việc chạy lệnh EXPLAIN.
 *
 * Nguyên tắc cốt lõi:
 * - MySQL: Chạy trên Azure VM Docker container tốn tài nguyên và mạng,
 *   tuyệt đối KHÔNG tự động trigger ngầm khi người dùng gõ phím hay chat tự do.
 *   Chỉ cho phép chạy khi có hành động tường minh từ người dùng (isExplicitUserAction = true).
 * - PostgreSQL: Chạy hoàn toàn cục bộ trong Web Worker trình duyệt (PGlite)
 *   với giao dịch tự hủy BEGIN...ROLLBACK và timeout 1.5s, an toàn tuyệt đối,
 *   nên cho phép trigger tự động ngầm.
 */
export function canRunExplain(
  engine: EngineType | undefined | null,
  isExplicitUserAction: boolean
): boolean {
  if (engine === "mysql") {
    return isExplicitUserAction === true;
  }
  return true;
}
