package ai

import (
	"regexp"
	"strings"
)

// jailbreakPatterns contains known prompt injection, jailbreak, and off-topic patterns.
// If any of these patterns appear in the question, it is rejected immediately.
// Note: "act as" is evaluated separately by isActAsJailbreak to avoid false positives
// on questions like "Does a primary key act as a unique index?".
var jailbreakPatterns = []string{
	// English injection & jailbreak
	"ignore previous instructions",
	"ignore all previous instructions",
	"ignore above instructions",
	"ignore instructions",
	"disregard previous instructions",
	"disregard all instructions",
	"disregard instructions",
	"forget all instructions",
	"forget previous instructions",
	"forget all rules",
	"forget your rules",
	"forget rules",
	"bypass rules",
	"pretend to be",
	"pretend you are",
	"you are now",
	"roleplay as",
	"jailbreak",
	"dan mode",
	"system prompt",
	"reveal prompt",
	"reveal your system prompt",
	"show your prompt",
	"what are your instructions",
	"output your prompt",
	"show instructions",

	// Vietnamese injection & jailbreak
	"bạn là ai",
	"mày là ai",
	"ngươi là ai",
	"bạn tên là gì",
	"mày tên là gì",
	"who are you",
	"what is your name",
	"quên hết quy tắc",
	"quên các quy tắc",
	"bỏ qua hướng dẫn",
	"bỏ qua các chỉ dẫn",
	"bỏ qua quy tắc",
	"lờ đi hướng dẫn",
	"hãy đóng vai",
	"hãy vào vai",
	"hãy giả vờ",

	// Off-topic creative writing & coding non-database
	"hãy làm thơ",
	"viết thơ",
	"làm thơ",
	"bài thơ",
	"write a poem",
	"write poem",
	"viết bài văn",
	"viết văn",
	"kể chuyện",
	"write a story",
	"write an essay",
	"code python",
	"viết python",
	"python script",
	"write python",

	// Math & General science non-database (specific to math/calculation, avoiding Lock Compatibility Matrix)
	"toán học",
	"giải toán",
	"tính toán ma trận",
	"nhân ma trận",
	"nghịch đảo ma trận",
	"tính ma trận",
	"matrix multiplication",
	"matrix calculation",
	"inverse matrix",
	"solve equation",
	"phương trình",

	// Common non-database off-topic
	"thời tiết",
	"weather",
	"công thức nấu",
	"recipe",
}

// validDbRoleTerms are database concepts allowed to follow "act as [a/an/the]".
var validDbRoleTerms = []string{
	"unique index",
	"covering index",
	"clustered index",
	"primary key",
	"foreign key",
	"secondary index",
	"composite index",
	"b-tree",
	"btree",
	"hash index",
	"gin index",
	"gist index",
	"constraint",
	"filter",
	"table",
	"column",
	"key",
	"surrogate key",
	"natural key",
	"candidate key",
	"queue",
	"cache",
	"lock",
}

// isActAsJailbreak checks if "act as" is used as a persona jailbreak (e.g. "act as a python developer",
// "act as dan", "act as someone") rather than legitimate database roles (e.g. "act as a unique index",
// "act as a covering index").
func isActAsJailbreak(text string) bool {
	cursor := text
	for {
		idx := strings.Index(cursor, "act as")
		if idx == -1 {
			break
		}
		// Check word boundary before "act"
		if idx > 0 {
			prev := cursor[idx-1]
			if (prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9') {
				// Part of another word like "compact asset", skip
				cursor = cursor[idx+6:]
				continue
			}
		}

		after := strings.TrimSpace(cursor[idx+len("act as"):])
		if after == "" {
			return true // "act as" alone at end is suspicious
		}

		// Strip articles if present: "a ", "an ", "the "
		target := after
		if strings.HasPrefix(target, "a ") {
			target = strings.TrimPrefix(target, "a ")
		} else if strings.HasPrefix(target, "an ") {
			target = strings.TrimPrefix(target, "an ")
		} else if strings.HasPrefix(target, "the ") {
			target = strings.TrimPrefix(target, "the ")
		}
		target = strings.TrimSpace(target)

		// Check if target starts with an allowed database concept/role
		isDbRole := false
		for _, dbTerm := range validDbRoleTerms {
			if strings.HasPrefix(target, dbTerm) {
				isDbRole = true
				break
			}
		}

		if !isDbRole {
			return true // Detected persona jailbreak
		}

		cursor = cursor[idx+6:]
	}
	return false
}

// normalizeText collapses all contiguous whitespace characters (spaces, tabs, newlines) into a single space.
func normalizeText(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

// stripCommentDelimiters replaces SQL comment tokens (-- and /* */) with spaces.
func stripCommentDelimiters(s string) string {
	r := strings.ReplaceAll(s, "/*", " ")
	r = strings.ReplaceAll(r, "*/", " ")
	r = strings.ReplaceAll(r, "--", " ")
	return r
}

// dbSubstrings are distinct multi-character or domain-specific database keywords.
var dbSubstrings = []string{
	"database",
	"cơ sở dữ liệu",
	"csdl",
	"b-tree",
	"btree",
	"postgres",
	"postgresql",
	"mysql",
	"innodb",
	"myisam",
	"sqlite",
	"pglite",
	"neon",
	"mariadb",
	"oracle",
	"sql server",
	"mssql",
	"deadlock",
	"tranh chấp",
	"tắc nghẽn",
	"truy vấn",
	"câu truy vấn",
	"chỉ mục",
	"kế hoạch thực thi",
	"execution plan",
	"tối ưu",
	"tối ưu hoá",
	"tối ưu hóa",
	"hiệu năng",
	"điểm nghẽn",
	"bottleneck",
	"khoá chính",
	"khóa chính",
	"khoá ngoại",
	"khóa ngoại",
	"ràng buộc",
	"bản ghi",
	"lược đồ",
	"foreign key",
	"primary key",
	"composite index",
	"covering index",
	"clustered index",
	"table scan",
	"index scan",
	"bitmap scan",
	"seq scan",
	"sequential scan",
	"work_mem",
	"autovacuum",
	"vacuum",
	"transaction",
	"giao dịch",
	"rollback",
	"commit",
	"isolation",
	"mvcc",
	"gap lock",
	"next-key",
	"sharding",
	"partition",
	"nested loop",
	"hash join",
	"merge join",
	"sort spill",
	"temp table",
	"ma trận tương thích khóa",
	"ma trận khóa",
	"lock compatibility matrix",
}

// dbWordRegex checks word boundaries for short database/SQL keywords or concepts.
var dbWordRegex = regexp.MustCompile(`(?i)\b(?:sql|db|select|insert|update|delete|drop|alter|create|truncate|upsert|merge|join|joins|where|from|group\s+by|order\s+by|having|limit|offset|union|distinct|into|values|cte|with|table|tables|bảng|cột|hàng|index|indexes|indices|query|queries|plan|plans|cost|costs|scan|scans|slow|fast|chậm|nhanh|lock|locks|khoá|khóa|row|rows|column|columns|col|cols|key|keys|fk|pk|view|views|trigger|triggers|cursor|heap|page|pages|buffer|cache|acid|schema|explain|analyze)\b`)

// IsDatabaseQuestion verifies whether a user question is legitimately related to database,
// SQL, performance, indexing, schema, execution plan, locks, or transactions, and rejects
// prompt injection or off-topic attempts.
// It returns (true, "") if valid, or (false, "error.nonDatabaseQuestion") if invalid.
func IsDatabaseQuestion(question string) (bool, string) {
	trimmed := strings.TrimSpace(question)
	if trimmed == "" {
		return false, "error.nonDatabaseQuestion"
	}

	// Step 0: Normalize whitespaces (spaces, tabs, newlines) on both raw text and comment-stripped text.
	normalized := normalizeText(trimmed)
	normalizedWithoutComments := normalizeText(stripCommentDelimiters(trimmed))

	// Step 1: Reject any known prompt injection, jailbreak, or forbidden off-topic pattern.
	for _, text := range []string{normalized, normalizedWithoutComments} {
		for _, pattern := range jailbreakPatterns {
			if strings.Contains(text, pattern) {
				return false, "error.nonDatabaseQuestion"
			}
		}
		if isActAsJailbreak(text) {
			return false, "error.nonDatabaseQuestion"
		}
	}

	// Step 2: Verify the question contains legitimate database/SQL context.
	for _, text := range []string{normalized, normalizedWithoutComments} {
		for _, kw := range dbSubstrings {
			if strings.Contains(text, kw) {
				return true, ""
			}
		}
		if dbWordRegex.MatchString(text) {
			return true, ""
		}
	}

	return false, "error.nonDatabaseQuestion"
}
