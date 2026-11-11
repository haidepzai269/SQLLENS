export type RuleTag = string;

export type KnowledgeEngine = "postgres" | "mysql" | "both";

export type KnowledgeSnippet = {
  tag: RuleTag;
  titleVi: string;
  titleEn: string;
  engine: KnowledgeEngine;
  contextSummaryVi: string;
  contextSummaryEn: string;
  sampleSqlGood?: string;
  sampleSqlBad?: string;
};
