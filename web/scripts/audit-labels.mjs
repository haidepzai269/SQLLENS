// Audit script: kiểm tra Nguyên tắc 1 & 2
// - Nguyên tắc 1: Mỗi kết luận mang đúng 1 nhãn chuẩn (Thật/Mô phỏng/Ước lượng/Chưa mô phỏng được).
// - Nguyên tắc 2: Không bao giờ nói "thiết kế này ổn", tốt/xấu/hoàn hảo/tối ưu.
import fs from "node:fs";
import path from "node:path";

const messagesDir = "messages";
const viDir = path.join(messagesDir, "vi");
const enDir = path.join(messagesDir, "en");

const patterns = {
  vi: [
    { regex: /\bổn\b/i, word: "ổn" },
    { regex: /\btốt\b/i, word: "tốt" },
    { regex: /\bxấu\b/i, word: "xấu" },
    { regex: /\btối\s+ưu\b/i, word: "tối ưu" },
    { regex: /\bhoàn\s+hảo\b/i, word: "hoàn hảo" },
  ],
  en: [
    { regex: /\bgood\b/i, word: "good" },
    { regex: /\bfine\b/i, word: "fine" },
    { regex: /\bperfect\b/i, word: "perfect" },
    { regex: /\boptimal\b/i, word: "optimal" },
    { regex: /\bbad\b/i, word: "bad" },
  ],
};

let biasCount = 0;
const findings = [];

function checkObject(obj, file, lang, prefix = "") {
  for (const [k, v] of Object.entries(obj)) {
    const keyPath = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      for (const { regex, word } of patterns[lang]) {
        if (regex.test(v)) {
          biasCount++;
          findings.push({
            lang,
            file,
            keyPath,
            word,
            text: v,
          });
        }
      }
    } else if (typeof v === "object" && v !== null) {
      checkObject(v, file, lang, keyPath);
    }
  }
}

for (const lang of ["vi", "en"]) {
  const dir = lang === "vi" ? viDir : enDir;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const fullPath = path.join(dir, f);
    const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    checkObject(json, f, lang);
  }
}

console.log(`=== ANTI-BIAS AUDIT REPORT: MESSAGES ===`);
console.log(`Tìm thấy ${biasCount} vị trí có từ ngữ cần rà soát trong messages/:\n`);
for (const item of findings) {
  console.log(`[${item.lang}] ${item.file} -> ${item.keyPath} (từ: "${item.word}")`);
  console.log(`  Chuỗi: "${item.text}"\n`);
}

// Quét các file source trong web/src (trừ các test)
console.log(`=== SCANNING SRC FOR HARDCODED BIAS & LABEL INTEGRITY ===`);
function walkDir(dir, cb) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== "node_modules" && ent.name !== ".next") walkDir(full, cb);
    } else if (ent.isFile() && (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx"))) {
      if (!ent.name.includes(".test.") && !ent.name.includes(".spec.")) {
        cb(full);
      }
    }
  }
}

const srcBiasPatterns = [
  /thiết kế (này )?(đã )?ổn/i,
  /design is (fine|ok|good)/i,
  /good design/i,
  /optimal design/i,
  /bad design/i,
  /perfect design/i,
];

let srcViolations = 0;
walkDir("src", (filePath) => {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    // Bỏ qua comments kiểm tra regex hoặc test pattern
    if (line.includes("const BAD =") || line.includes("bannedPatterns")) return;
    for (const pat of srcBiasPatterns) {
      if (pat.test(line)) {
        srcViolations++;
        console.log(`[VIOLATION] ${filePath}:${idx + 1} matches ${pat}`);
        console.log(`  Line: ${line.trim()}`);
      }
    }
  });
});

console.log(`Số vi phạm trực tiếp trong src: ${srcViolations}`);

// Quét kiểm tra ConclusionBadge và các nhãn kết luận
console.log(`\n=== CHECKING CONCLUSION LABELS IN TABS & FINDINGS ===`);
let conclusionMatches = 0;
walkDir("src", (filePath) => {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes("ConclusionBadge") || content.includes("conclusionLabel")) {
    conclusionMatches++;
  }
});
console.log(`Tìm thấy ${conclusionMatches} files sử dụng hoặc tham chiếu ConclusionBadge/conclusionLabel.`);
