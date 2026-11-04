import type { Plan } from "./plan";

// Một phía của phép so sánh. Không có trường thời gian: so bằng số dòng và số trang (nguyên tắc 3 trong CLAUDE.md).
export type WhatIfSide = { rows: number; pagesRead: number; plan: Plan };

export type WhatIfData = {
  before: WhatIfSide;
  after: WhatIfSide;
  // Chỉ mô tả số trang đổi thế nào, không kết luận thiết kế tốt hay xấu.
  pagesChange: "fewer" | "same" | "more";
  // true khi cách sửa làm câu thăm dò trả số dòng khác, người dùng phải biết kết quả không còn tương đương.
  rowsChanged: boolean;
};

// Số đo thật của một index ở một mức dữ liệu, nền cho công thức ngoại suy.
export type CapacitySample = {
  index: string;
  table: string;
  rows: number;
  // Số tầng, tính cả leaf.
  height: number;
  indexPages: number;
  leafPages: number;
  // Số khóa trung bình mỗi leaf và số trang con trung bình mỗi trang internal. Cây chỉ có một tầng thì chưa có internalFanout.
  leafFanout: number;
  internalFanout?: number;
  // Số trang câu thăm dò đã đọc, nếu đo được.
  pagesRead?: number;
};

// Nhãn nằm ở Conclusion bọc ngoài: Thật đến 500k, Ước lượng trên 500k. Không có QPS, không có độ trễ.
export type CapacityPoint = { rows: number; height: number; indexBytes: number; pagesRead?: number };
