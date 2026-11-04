// Kết quả thô của một luật kiểm tra schema hoặc query. Đây chưa phải kết luận: STR041 gắn bằng chứng và đúng một nhãn.
export type RuleHit = {
  ruleId: string;
  // Khóa dịch của câu mô tả và giá trị điền vào câu đó.
  messageKey: string;
  values?: Record<string, string | number>;
  table?: string;
  column?: string;
  statementIndex?: number;
  // Vị trí trong SQL để tô, đếm từ 0, nếu có.
  start?: number;
  end?: number;
};

// Mức độ tách khỏi nhãn kết luận. Đỏ là hỏng, vàng là ước lượng hoặc chưa mô phỏng được, xanh là không hỏng trong kịch bản đã chạy (không có nghĩa thiết kế ổn).
export type Severity = "broken" | "unverified" | "not_broken";
export type FindingData = { hit: RuleHit; severity: Severity; planNodeId?: string };
