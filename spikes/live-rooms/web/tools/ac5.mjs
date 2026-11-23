// AC5 — giờ máy chủ mà một phòng live tiêu tốn, tính từ keep-awake.yml thật và trần
// 750 giờ/tháng của Render free.
//
// Đây là PHÉP TÍNH, không phải phép đo: không có cách nào đo giờ Render thật khi không
// được gọi dịch vụ thật. Vì vậy mọi số trong file này mang nhãn **Ước lượng**.
// Đầu vào:
//   - .github/workflows/keep-awake.yml: cron "*/10 0-16 * * *" (UTC) = 07:00-23:50 giờ VN
//   - Render free: tự ngủ sau 15 phút không có lưu lượng vào (ghi ở _bmad-output Task017)
//   - Trần 750 giờ instance/tháng cho cả workspace (cùng nguồn)
//
// Chạy: node tools/ac5.mjs
import { save } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---- Đọc cron thật từ file, không chép tay ----
const yml = readFileSync(join(process.cwd(), "..", "..", "..", ".github", "workflows", "keep-awake.yml"), "utf8");
const cronLine = yml.split(/\r?\n/).find((l) => l.includes("cron:")) ?? "";
const cron = (cronLine.match(/"([^"]+)"/) ?? [])[1] ?? "";
if (!cron) {
  console.error("không đọc được cron từ keep-awake.yml");
  process.exit(1);
}
const [minF, hourF] = cron.split(" ");
const pingEveryMin = Number(minF.replace("*/", ""));
const hourFrom = Number(hourF.split("-")[0]);
const hourTo = Number(hourF.split("-")[1]);
const IDLE_SLEEP_MIN = 15; // Render free
const CAP_H = 750;

// Khung giờ UTC mà cron phủ, tính theo phút.
const firstPingMin = hourFrom * 60;
const lastPingMin = hourTo * 60 + (60 - pingEveryMin); // phút của lần ping cuối trong giờ cuối
const awakeMinutes = lastPingMin - firstPingMin + IDLE_SLEEP_MIN;
const awakeHoursPerDay = awakeMinutes / 60;

const daysPerMonth = 30;
const baseHoursPerMonth = awakeHoursPerDay * daysPerMonth;
const headroomHours = CAP_H - baseHoursPerMonth;

// ---- Ca 1: phòng live mở BÊN TRONG khung thức ----
// Máy đã thức vì keep-awake, nên giờ máy tăng thêm = 0. Chỉ tốn CPU và băng thông.
const insideExtraHours = 0;

// ---- Ca 2: phòng live mở NGOÀI khung thức, một lần ----
// Ví dụ 03:00 VN, xem 30 phút. Server thức lúc request đầu, ngủ lại sau 15 phút im lặng.
const outsideSessionMin = 30;
const outsideOnceExtraHours = (outsideSessionMin + IDLE_SLEEP_MIN) / 60;

// ---- Ca 3: phòng live giữ mở suốt đêm, mỗi đêm ----
// Từ lúc keep-awake thôi ping (23:50 + 15 phút = 00:05) tới lần ping đầu (07:00).
const nightMinutes = 24 * 60 - awakeMinutes;
const nightExtraHoursPerMonth = (nightMinutes / 60) * daysPerMonth;

// ---- Ca 4: một dịch vụ Render thứ hai chỉ để chạy realtime ----
// Nếu tách realtime thành service riêng thì service đó cũng phải thức cùng khung giờ.
const twoServicesHours = baseHoursPerMonth * 2;

const out = {
  label: "Ước lượng",
  inputs: {
    cron,
    pingEveryMin,
    hourFromUtc: hourFrom,
    hourToUtc: hourTo,
    firstPingUtcMin: firstPingMin,
    lastPingUtcMin: lastPingMin,
    idleSleepMin: IDLE_SLEEP_MIN,
    capHoursPerMonth: CAP_H,
    daysPerMonth,
    sourceFile: ".github/workflows/keep-awake.yml",
  },
  awakeWindow: {
    hoursPerDay: awakeHoursPerDay,
    minutesPerDay: awakeMinutes,
    note: "keep-awake ping 10 phút/lần, Render ngủ sau 15 phút → thức liền mạch cả khung",
  },
  cases: {
    baseMonth: { hours: baseHoursPerMonth, headroom: headroomHours, usedPctOfCap: (baseHoursPerMonth / CAP_H) * 100 },
    insideWindow: { extraHours: insideExtraHours, note: "máy đã thức sẵn, giờ máy không tăng" },
    outsideOnce30min: {
      extraHours: outsideOnceExtraHours,
      note: "thức theo request rồi ngủ lại sau 15 phút",
    },
    outsideAllNight: {
      nightMinutes,
      extraHoursPerMonth: nightExtraHoursPerMonth,
      totalHoursPerMonth: baseHoursPerMonth + nightExtraHoursPerMonth,
      usedPctOfCap: ((baseHoursPerMonth + nightExtraHoursPerMonth) / CAP_H) * 100,
      overCap: baseHoursPerMonth + nightExtraHoursPerMonth > CAP_H,
    },
    twoRenderServices: {
      hours: twoServicesHours,
      usedPctOfCap: (twoServicesHours / CAP_H) * 100,
      overCap: twoServicesHours > CAP_H,
      note: "một service thứ hai cho realtime cũng thức cùng khung",
    },
  },
  formula: {
    awakeHoursPerDay: "(lastPingUtcMin - firstPingUtcMin + idleSleepMin) / 60",
    baseHoursPerMonth: "awakeHoursPerDay * daysPerMonth",
    nightExtraHoursPerMonth: "((1440 - awakeMinutes) / 60) * daysPerMonth",
    insideExtraHours: "0 (máy đã thức)",
  },
  caveats: [
    "Không đo được giờ Render thật: task cấm gọi Render thật, và giờ instance chỉ hiện trong dashboard.",
    "Chưa biết Render có tính một kết nối SSE đang mở là 'lưu lượng vào' hay không. Nếu CÓ, phòng live mở qua đêm sẽ tự giữ máy thức và ca 3 thành hiện thực. Nếu KHÔNG, SSE đứt sau 15 phút và phòng live ngoài khung thức không dùng được — cả hai đều là tin xấu cho tính năng.",
    "Cron của GitHub Actions chạy trễ vài phút tới vài chục phút lúc cao điểm; khung thức thực tế có thể ngắn hơn, nên số giờ nền là cận trên.",
    "Render free còn bị giới hạn băng thông 100 GB/tháng; chưa tính ở đây.",
  ],
};

save("ac5.json", out);
console.log(JSON.stringify(out.cases, null, 2));
console.log(`\nkhung thức: ${awakeHoursPerDay.toFixed(3)} h/ngày → ${baseHoursPerMonth.toFixed(2)} h/tháng, trần ${CAP_H} h, còn ${headroomHours.toFixed(2)} h`);
