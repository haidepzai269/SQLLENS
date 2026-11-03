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
