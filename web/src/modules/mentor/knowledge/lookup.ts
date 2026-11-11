import { KNOWLEDGE_BY_TAG } from "./catalog";
import type { KnowledgeSnippet, RuleTag } from "./types";

export const MAX_KNOWLEDGE_CHARS = 2000;

function formatSnippet(snippet: KnowledgeSnippet, isEn: boolean): string {
  const engineLabel =
    snippet.engine === "postgres"
      ? "[PostgreSQL]"
      : snippet.engine === "mysql"
      ? "[MySQL]"
      : "[PostgreSQL / MySQL]";

  const title = isEn ? snippet.titleEn : snippet.titleVi;
  const summary = isEn ? snippet.contextSummaryEn : snippet.contextSummaryVi;
  const lines: string[] = [`### ${engineLabel} ${title} (${snippet.tag})`, summary];

  if (snippet.sampleSqlBad) {
    const label = isEn ? "- **Anti-pattern SQL:**" : "- **SQL chưa tối ưu (Anti-pattern):**";
    lines.push(label, "```sql", snippet.sampleSqlBad, "```");
  }

  if (snippet.sampleSqlGood) {
    const label = isEn ? "- **Recommended SQL:**" : "- **SQL khuyến nghị tối ưu:**";
    lines.push(label, "```sql", snippet.sampleSqlGood, "```");
  }

  return lines.join("\n");
}

/**
 * Tra cứu kho tri thức kỹ thuật in-memory chuẩn theo RuleTag.
 * - Độ phức tạp: O(1) tra cứu cho mỗi tag thông qua Map.
 * - Ngôn ngữ: "vi" (mặc định) hoặc "en". Fallback về "vi" nếu locale không hợp lệ.
 * - Ngân sách: Tối đa 2.000 ký tự (~400 tokens), ưu tiên các tag đầu tiên và cắt gọn.
 * - An toàn tuyệt đối: Không ném Exception khi mảng rỗng, tag lạ hoặc kiểu dữ liệu bất thường.
 */
export function lookupKnowledge(
  tags: RuleTag[],
  locale: "vi" | "en" = "vi"
): string {
  if (!Array.isArray(tags) || tags.length === 0) {
    return "";
  }

  const isEn = locale === "en";

  // Lọc, loại bỏ khoảng trắng và deduplicate bảo toàn thứ tự xuất hiện
  const seen = new Set<string>();
  const uniqueTags: string[] = [];
  for (const rawTag of tags) {
    if (typeof rawTag === "string") {
      const cleanTag = rawTag.trim();
      if (cleanTag && !seen.has(cleanTag)) {
        seen.add(cleanTag);
        uniqueTags.push(cleanTag);
      }
    }
  }

  if (uniqueTags.length === 0) {
    return "";
  }

  const matchedSnippets: KnowledgeSnippet[] = [];
  for (const tag of uniqueTags) {
    const item = KNOWLEDGE_BY_TAG.get(tag);
    if (item) {
      matchedSnippets.push(item);
    }
  }

  if (matchedSnippets.length === 0) {
    return "";
  }

  const parts: string[] = [];
  let currentLength = 0;

  for (const snippet of matchedSnippets) {
    const block = formatSnippet(snippet, isEn);
    const separator = parts.length > 0 ? "\n\n" : "";
    const addedLength = separator.length + block.length;

    if (currentLength + addedLength <= MAX_KNOWLEDGE_CHARS) {
      parts.push(block);
      currentLength += addedLength;
    } else {
      // Nếu chưa có snippet nào được nạp (block đầu tiên quá 2.000 ký tự), cắt gọn vừa khít ngân sách
      if (parts.length === 0) {
        parts.push(block.slice(0, MAX_KNOWLEDGE_CHARS));
        currentLength = MAX_KNOWLEDGE_CHARS;
      }
      // Dừng lại để bảo toàn trọn vẹn các tag đầu tiên và không vượt ngân sách 2.000 ký tự
      break;
    }
  }

  const result = parts.join("\n\n");
  return result.length > MAX_KNOWLEDGE_CHARS ? result.slice(0, MAX_KNOWLEDGE_CHARS) : result;
}
