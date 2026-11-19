"use client";

import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  Printer,
  ArrowLeft,
  OctagonX,
  TriangleAlert,
  CircleDot,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConclusionBadge } from "@/components/ui/conclusion-badge";
import type { Outcome } from "@/contracts/conclusion";
import type { FindingData, RuleHit, Severity } from "@/contracts/finding";
import type { Plan, PlanNode } from "@/contracts/plan";
import { useWorkspaceStore } from "@/modules/workspace/store";
import { bootWorkspace } from "@/modules/workspace/hydrate";
import { checkQueries } from "@/modules/findings/query-rules";
import { checkSchema } from "@/modules/findings/schema-rules";
import { attachEvidence } from "@/modules/findings/evidence";
import { parseSql } from "@/modules/sql-intake/parser";
import { lastSelect } from "@/modules/lab/stage/stage-data";
import "./print.css";

const emptySubscribe = () => () => {};
let cachedClientDate: Date | null = null;
function getClientDateSnapshot(): Date {
  return (cachedClientDate ??= new Date());
}
function getServerDateSnapshot(): undefined {
  return undefined;
}

export interface FindingItem {
  hit: RuleHit;
  outcome: Outcome<FindingData>;
}

export interface AuditReportData {
  projectName: string;
  engine: "postgres" | "mysql" | "sqlite";
  createdAt?: Date | string;
  tableCount?: number;
  statementCount?: number;
  findings?: FindingItem[];
  planOutcome?: Outcome<Plan> | null;
  selectSql?: string;
}

export interface HealthScoreResult {
  score: number | null;
  label: "estimated" | "not_simulated";
  brokenCount: number;
  unverifiedCount: number;
  notBrokenCount: number;
  totalFindings: number;
}

/**
 * Tính điểm sức khỏe ước lượng dựa trên các luật kiểm toán trong sandbox.
 * Core Rule 2: Điểm này luôn mang nhãn "estimated" (hoặc "not_simulated" nếu chưa có dữ liệu)
 * và tuyệt đối không hàm ý "thiết kế này ổn/an toàn".
 */
export function calculateHealthScore(items: FindingItem[] | undefined): HealthScoreResult {
  if (!items || items.length === 0) {
    return {
      score: null,
      label: "not_simulated",
      brokenCount: 0,
      unverifiedCount: 0,
      notBrokenCount: 0,
      totalFindings: 0,
    };
  }

  let brokenCount = 0;
  let unverifiedCount = 0;
  let notBrokenCount = 0;

  for (const item of items) {
    if (item.outcome.kind === "conclusion") {
      const sev = item.outcome.data.severity;
      if (sev === "broken") brokenCount++;
      else if (sev === "unverified") unverifiedCount++;
      else if (sev === "not_broken") notBrokenCount++;
    } else {
      unverifiedCount++;
    }
  }

  // Khởi điểm 100 điểm:
  // Mỗi lỗi broken (hỏng nghiêm trọng) trừ 20 điểm (tối đa trừ 60 điểm)
  // Mỗi cảnh báo unverified trừ 8 điểm (tối đa trừ 40 điểm)
  const penalty = Math.min(60, brokenCount * 20) + Math.min(40, unverifiedCount * 8);
  const score = Math.max(0, 100 - penalty);

  return {
    score,
    label: "estimated",
    brokenCount,
    unverifiedCount,
    notBrokenCount,
    totalFindings: items.length,
  };
}

/** Định dạng ngày tháng an toàn theo locale */
export function formatDate(date: Date | string | undefined, locale: string): string {
  if (!date) return "--";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);

  const loc = locale === "vi" ? "vi-VN" : "en-US";
  return new Intl.DateTimeFormat(loc, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Định dạng số an toàn theo locale */
export function formatNumber(num: number | undefined, locale: string): string {
  if (num === undefined || num === null) return "--";
  const loc = locale === "vi" ? "vi-VN" : "en-US";
  return new Intl.NumberFormat(loc).format(num);
}

/** Làm phẳng cây PlanNode để hiển thị trong báo cáo in ấn */
export function flattenPlanTree(
  node: PlanNode,
  depth = 0,
): Array<{ node: PlanNode; depth: number }> {
  const result: Array<{ node: PlanNode; depth: number }> = [{ node, depth }];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      result.push(...flattenPlanTree(child, depth + 1));
    }
  }
  return result;
}

export interface AuditReportProps {
  data?: AuditReportData;
  locale?: string;
  onPrint?: () => void;
  onBack?: () => void;
  showToolbar?: boolean;
}

export function AuditReport({
  data: propData,
  locale = "vi",
  onPrint,
  onBack,
  showToolbar = true,
}: AuditReportProps) {
  const t = useTranslations("export.audit");
  const tr = useTranslations() as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;

  // Lấy dữ liệu từ useWorkspaceStore khi propData không truyền vào
  const storeProjects = useWorkspaceStore((s) => s.projects);
  const storeActiveProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const storeTabs = useWorkspaceStore((s) => s.tabs);
  const storeActiveTabId = useWorkspaceStore((s) => s.activeTabId);

  // Tự động nạp workspace từ IndexedDB nếu người dùng mở trực tiếp URL /print/audit
  useEffect(() => {
    if (!propData && storeProjects.length === 0) {
      void bootWorkspace();
    }
  }, [propData, storeProjects.length]);

  const activeProject = useMemo(
    () => storeProjects.find((p) => p.id === storeActiveProjectId) || storeProjects[0],
    [storeProjects, storeActiveProjectId],
  );
  const activeTab = useMemo(() => {
    const projectTabs = storeTabs.filter((tab) => tab.projectId === activeProject?.id);
    return projectTabs.find((tab) => tab.id === storeActiveTabId) || projectTabs[0];
  }, [storeTabs, activeProject?.id, storeActiveTabId]);

  const rawSql = activeTab?.sql?.trim() ?? "";
  const activeEngine = activeProject?.engine ?? "postgres";

  const clientNow = useSyncExternalStore(emptySubscribe, getClientDateSnapshot, getServerDateSnapshot);
  const [computedData, setComputedData] = useState<AuditReportData | null>(null);

  useEffect(() => {
    if (propData || !rawSql) return;

    let live = true;
    parseSql(rawSql, activeEngine).then(
      (outcome) => {
        if (!live) return;
        const statements = outcome.ok ? outcome.statements : undefined;
        const lastSel = statements ? lastSelect(rawSql, statements) : undefined;

        if (!statements || statements.length === 0) {
          setComputedData({
            projectName: activeProject?.name || "SQLLens Project",
            engine: activeEngine,
            createdAt: activeProject?.createdAt ? new Date(activeProject.createdAt) : undefined,
            tableCount: 0,
            statementCount: 0,
            findings: [],
            planOutcome: null,
            selectSql: lastSel?.sql,
          });
          return;
        }

        const hits = [
          ...checkSchema(statements, activeEngine),
          ...checkQueries(statements, activeEngine, rawSql),
        ];
        const out = attachEvidence(hits, { plans: [] });
        const items: FindingItem[] = hits.map((hit, k) => ({ hit, outcome: out[k] }));

        const tableNames = new Set<string>();
        for (const st of statements) {
          if (st.tables) st.tables.forEach((t: string) => tableNames.add(t));
        }

        setComputedData({
          projectName: activeProject?.name || "SQLLens Project",
          engine: activeEngine,
          createdAt: activeProject?.createdAt ? new Date(activeProject.createdAt) : undefined,
          tableCount: tableNames.size,
          statementCount: statements.length,
          findings: items,
          planOutcome: null,
          selectSql: lastSel?.sql,
        });
      },
      () => {
        if (!live) return;
        setComputedData({
          projectName: activeProject?.name || "SQLLens Project",
          engine: activeEngine,
          createdAt: undefined,
          tableCount: 0,
          statementCount: 0,
          findings: [],
          planOutcome: null,
          selectSql: undefined,
        });
      },
    );

    return () => {
      live = false;
    };
  }, [propData, rawSql, activeEngine, activeProject]);

  const reportData = useMemo<AuditReportData>(() => {
    if (propData) return propData;
    if (computedData) return computedData;

    return {
      projectName: activeProject?.name || "SQLLens Project",
      engine: activeEngine,
      createdAt: activeProject?.createdAt ? new Date(activeProject.createdAt) : clientNow,
      tableCount: 0,
      statementCount: 0,
      findings: [],
      planOutcome: null,
      selectSql: undefined,
    };
  }, [propData, computedData, activeProject, activeEngine, clientNow]);

  const {
    projectName,
    engine,
    createdAt,
    tableCount,
    statementCount,
    findings = [],
    planOutcome,
    selectSql,
  } = reportData;

  const health = useMemo(() => calculateHealthScore(findings), [findings]);

  // Sắp xếp findings: Broken trước, Unverified sau, Not broken cuối
  const sortedFindings = useMemo(() => {
    const rank = (it: FindingItem) =>
      it.outcome.kind !== "conclusion"
        ? 1
        : { broken: 0, unverified: 1, not_broken: 2 }[it.outcome.data.severity];
    return [...findings].sort((a, b) => rank(a) - rank(b));
  }, [findings]);

  // Ca biên 30 findings: Trang 2 A4 hiển thị tối đa 10 findings hàng đầu để không tràn trang
  const MAX_PAGE2_FINDINGS = 10;
  const displayedFindings = sortedFindings.slice(0, MAX_PAGE2_FINDINGS);
  const remainingFindingsCount = Math.max(0, sortedFindings.length - MAX_PAGE2_FINDINGS);

  const handlePrint = () => {
    if (onPrint) onPrint();
    else if (typeof window !== "undefined") window.print();
  };

  const handleBack = () => {
    if (onBack) onBack();
    else if (typeof window !== "undefined") window.history.back();
  };

  // Làm phẳng plan tree nếu có
  const flatPlanNodes = useMemo(() => {
    if (planOutcome?.kind === "conclusion" && planOutcome.data?.root) {
      return flattenPlanTree(planOutcome.data.root);
    }
    return [];
  }, [planOutcome]);

  const planData = planOutcome?.kind === "conclusion" ? planOutcome.data : null;

  return (
    <div className="report-preview-container" data-testid="audit-report-container">
      {/* Thanh công cụ xem trước (Ẩn khi in ấn) */}
      {showToolbar && (
        <div className="report-toolbar no-print" data-testid="report-toolbar">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBack}
              className="h-8 gap-1.5 text-xs font-medium cursor-pointer"
              data-testid="report-back-btn"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span>{t("backButton")}</span>
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground truncate max-w-[200px]">
                {projectName}
              </span>
              <span>•</span>
              <span className="uppercase font-mono">{engine}</span>
              <span>•</span>
              <span>{t("pageIndicator", { current: 1, total: 3 })}</span>
            </div>
          </div>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handlePrint}
            className="h-8 gap-1.5 text-xs font-medium cursor-pointer"
            data-testid="report-print-btn"
          >
            <Printer className="size-3.5" aria-hidden="true" />
            <span>{t("printButton")}</span>
          </Button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TRANG 1: BÌA + ĐIỂM SỨC KHỎE + TÓM TẮT RỦI RO */}
      {/* ========================================================================= */}
      <section
        className="report-page avoid-break"
        data-page="1"
        data-testid="report-page-1"
        aria-label="Audit Report Page 1"
      >
        {/* Header trang 1 */}
        <header className="report-page-header">
          <div className="flex items-center gap-2 min-w-0">
            <Database className="size-3.5 shrink-0 text-slate-700" aria-hidden="true" />
            <span className="font-bold text-slate-900 truncate max-w-[280px]">
              {projectName}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase text-slate-700 border border-slate-200">
              {engine}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span>{formatDate(createdAt, locale)}</span>
            <span className="font-semibold text-slate-800">
              {t("pageIndicator", { current: 1, total: 3 })}
            </span>
          </div>
        </header>

        {/* Nội dung trang 1 */}
        <main className="report-page-body justify-between">
          {/* Cụm tiêu đề báo cáo */}
          <div className="border-b border-slate-200 pb-4">
            <div className="inline-block rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-indigo-700 border border-indigo-200 mb-2">
              {t("branding")}
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 break-words mb-1">
              {t("title")}
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">{t("subtitle")}</p>
          </div>

          {/* Bảng Metadata tổng quan */}
          <div className="grid grid-cols-4 gap-2 rounded border border-slate-200 bg-slate-50 p-2.5 text-xs">
            <div>
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider">
                {t("metadata.project")}
              </span>
              <span className="font-semibold text-slate-800 break-words line-clamp-1">
                {projectName}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider">
                {t("metadata.engine")}
              </span>
              <span className="font-semibold text-slate-800 uppercase font-mono">
                {engine}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider">
                {t("metadata.tables")} / {t("metadata.statements")}
              </span>
              <span className="font-semibold text-slate-800">
                {formatNumber(tableCount, locale)} / {formatNumber(statementCount, locale)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider">
                {t("metadata.environment")}
              </span>
              <span className="font-semibold text-slate-800">
                {t("metadata.environmentVal")}
              </span>
            </div>
          </div>

          {/* Điểm sức khỏe cơ sở dữ liệu (Database Health Score) */}
          <div
            className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-xs"
            data-testid="health-score-card"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>{t("healthScore.title")}</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    ({t("healthScore.subtitle")})
                  </span>
                </h2>
              </div>
              <ConclusionBadge label={health.label} testId="health-score-badge" />
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-baseline gap-1 bg-white border border-slate-200 rounded-md px-4 py-2 shadow-xs">
                <span
                  className="text-3xl font-extrabold tracking-tight text-slate-900 font-mono"
                  data-testid="health-score-value"
                >
                  {health.score !== null ? health.score : t("healthScore.noScore")}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {t("healthScore.outOf")}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed m-0 flex-1">
                {t("healthScore.desc")}
              </p>
            </div>
          </div>

          {/* Tóm tắt số lượng rủi ro (Risk Summary) */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 m-0">
              {t("summary.title")}
            </h3>
            <div className="grid grid-cols-3 gap-2.5">
              {/* Thẻ Broken */}
              <div
                className="rounded border border-red-200 bg-red-50/60 p-2.5 flex flex-col justify-between"
                data-testid="summary-broken"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-red-800">
                    <OctagonX className="size-3.5 shrink-0 text-red-600" aria-hidden="true" />
                    <span>{t("summary.broken")}</span>
                  </span>
                  <span className="text-sm font-extrabold text-red-900 font-mono">
                    {formatNumber(health.brokenCount, locale)}
                  </span>
                </div>
                <p className="text-[10px] text-red-700/90 leading-tight m-0">
                  {t("summary.brokenDesc")}
                </p>
              </div>

              {/* Thẻ Unverified */}
              <div
                className="rounded border border-amber-200 bg-amber-50/60 p-2.5 flex flex-col justify-between"
                data-testid="summary-unverified"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                    <TriangleAlert className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                    <span>{t("summary.unverified")}</span>
                  </span>
                  <span className="text-sm font-extrabold text-amber-900 font-mono">
                    {formatNumber(health.unverifiedCount, locale)}
                  </span>
                </div>
                <p className="text-[10px] text-amber-700/90 leading-tight m-0">
                  {t("summary.unverifiedDesc")}
                </p>
              </div>

              {/* Thẻ Not Broken (Core Rule 2: không hàm ý thiết kế ổn) */}
              <div
                className="rounded border border-emerald-200 bg-emerald-50/60 p-2.5 flex flex-col justify-between"
                data-testid="summary-not-broken"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                    <CircleDot className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span>{t("summary.notBroken")}</span>
                  </span>
                  <span className="text-sm font-extrabold text-emerald-900 font-mono">
                    {formatNumber(health.notBrokenCount, locale)}
                  </span>
                </div>
                <p className="text-[10px] text-emerald-700/90 leading-tight m-0">
                  {t("summary.notBrokenDesc")}
                </p>
              </div>
            </div>
          </div>

          {/* Phạm vi kiểm toán (Audit Scope) */}
          <div className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs">
            <span className="font-bold text-slate-800 block mb-1">
              {t("scope.title")}
            </span>
            <p className="text-[11px] text-slate-600 leading-relaxed m-0">
              {t("scope.desc")}
            </p>
          </div>
        </main>

        {/* Footer trang 1 (AC5) */}
        <footer className="report-page-footer">
          <p className="m-0 text-slate-500 max-w-[80%]">{t("disclaimer")}</p>
          <span className="font-semibold text-slate-700 shrink-0">{t("branding")}</span>
        </footer>
      </section>

      {/* ========================================================================= */}
      {/* TRANG 2: CHI TIẾT RỦI RO & BẰNG CHỨNG (FINDINGS & EVIDENCE) */}
      {/* ========================================================================= */}
      <section
        className="report-page avoid-break"
        data-page="2"
        data-testid="report-page-2"
        aria-label="Audit Report Page 2"
      >
        {/* Header trang 2 */}
        <header className="report-page-header">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-slate-900 truncate max-w-[280px]">
              {projectName}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase text-slate-700 border border-slate-200">
              {engine}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span>{formatDate(createdAt, locale)}</span>
            <span className="font-semibold text-slate-800">
              {t("pageIndicator", { current: 2, total: 3 })}
            </span>
          </div>
        </header>

        {/* Nội dung trang 2 */}
        <main className="report-page-body">
          <div className="border-b border-slate-200 pb-2 mb-3">
            <h2 className="text-base font-bold text-slate-900 m-0">
              {t("findings.title")}
            </h2>
            <p className="text-xs text-slate-600 m-0 mt-0.5">
              {findings.length > 0
                ? t("findings.count", { count: findings.length })
                : t("findings.subtitle")}
            </p>
          </div>

          {/* AC6: Trạng thái rỗng khi chưa có kết luận */}
          {findings.length === 0 ? (
            <div
              className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center bg-slate-50/50"
              data-testid="findings-empty"
            >
              <ConclusionBadge label="not_simulated" className="mb-2" />
              <h3 className="text-sm font-bold text-slate-800 mb-1">
                {t("empty.title")}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm m-0">
                {t("empty.findingsDesc")}
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-between overflow-hidden">
              {/* Bảng danh sách findings */}
              <div className="overflow-hidden rounded border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-1.5 px-2.5 w-[22%]">{t("findings.colSeverity")}</th>
                      <th className="py-1.5 px-2.5 w-[38%]">{t("findings.colRule")}</th>
                      <th className="py-1.5 px-2.5 w-[40%]">{t("findings.colEvidence")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {displayedFindings.map((item, idx) => {
                      const c = item.outcome.kind === "conclusion" ? item.outcome : null;
                      const sev: Severity = c ? c.data.severity : "unverified";
                      const h = c ? c.data.hit : item.hit;
                      const label = c ? c.label : "not_simulated";

                      const sevStyle = {
                        broken: "text-red-700 bg-red-50/50",
                        unverified: "text-amber-700 bg-amber-50/50",
                        not_broken: "text-emerald-700 bg-emerald-50/50",
                      }[sev];

                      return (
                        <tr
                          key={idx}
                          className={`avoid-break ${sevStyle}`}
                          data-testid="finding-row"
                          data-severity={sev}
                        >
                          {/* Cột 1: Mức độ & Nhãn */}
                          <td className="py-2 px-2.5 align-top">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="font-bold text-[11px] leading-tight flex items-center gap-1">
                                {sev === "broken" && (
                                  <OctagonX className="size-3 text-red-600 shrink-0" />
                                )}
                                {sev === "unverified" && (
                                  <TriangleAlert className="size-3 text-amber-600 shrink-0" />
                                )}
                                {sev === "not_broken" && (
                                  <CircleDot className="size-3 text-emerald-600 shrink-0" />
                                )}
                                <span>{tr(`findingsUi.severity.${sev}`)}</span>
                              </span>
                              <ConclusionBadge label={label} className="text-[10px] h-4.5" />
                            </div>
                          </td>

                          {/* Cột 2: Luật & Đối tượng (Tên bảng dài 60 ký tự không tràn lề) */}
                          <td className="py-2 px-2.5 align-top">
                            <div className="flex flex-col gap-0.5">
                              {h.table && (
                                <span className="font-mono font-semibold text-[11px] text-slate-800 break-words max-w-[200px]">
                                  {h.table}
                                  {h.column ? `.${h.column}` : ""}
                                </span>
                              )}
                              <p className="m-0 text-[11px] text-slate-700 leading-snug break-words">
                                {tr(h.messageKey, h.values)}
                              </p>
                            </div>
                          </td>

                          {/* Cột 3: Bằng chứng kỹ thuật cụ thể */}
                          <td className="py-2 px-2.5 align-top">
                            {c && c.evidence && c.evidence.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {c.evidence.map((ev, k) => (
                                  <p
                                    key={k}
                                    className="m-0 text-[10.5px] text-slate-600 leading-tight break-words"
                                  >
                                    • {tr(ev.messageKey, ev.values)}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="m-0 text-[10.5px] text-slate-500 italic break-words">
                                {item.outcome.kind === "not_simulated"
                                  ? tr((item.outcome as { reasonKey: string }).reasonKey)
                                  : t("empty.title")}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Thông báo phân trang thu gọn khi vượt quá 10 findings (Ca biên 30 findings) */}
              {remainingFindingsCount > 0 && (
                <div
                  className="rounded border border-indigo-200 bg-indigo-50/50 p-2 text-center text-[11px] text-indigo-900 mt-2"
                  data-testid="findings-more-notice"
                >
                  {t("findings.moreFindings", {
                    shown: displayedFindings.length,
                    total: findings.length,
                  })}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Footer trang 2 (AC5) */}
        <footer className="report-page-footer">
          <p className="m-0 text-slate-500 max-w-[80%]">{t("disclaimer")}</p>
          <span className="font-semibold text-slate-700 shrink-0">{t("branding")}</span>
        </footer>
      </section>

      {/* ========================================================================= */}
      {/* TRANG 3: KẾ HOẠCH THỰC THI TRUY VẤN (QUERY EXECUTION PLAN) */}
      {/* ========================================================================= */}
      <section
        className="report-page avoid-break"
        data-page="3"
        data-testid="report-page-3"
        aria-label="Audit Report Page 3"
      >
        {/* Header trang 3 */}
        <header className="report-page-header">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-slate-900 truncate max-w-[280px]">
              {projectName}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase text-slate-700 border border-slate-200">
              {engine}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span>{formatDate(createdAt, locale)}</span>
            <span className="font-semibold text-slate-800">
              {t("pageIndicator", { current: 3, total: 3 })}
            </span>
          </div>
        </header>

        {/* Nội dung trang 3 */}
        <main className="report-page-body justify-between">
          <div className="border-b border-slate-200 pb-2 mb-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 m-0">
                {t("plan.title")}
              </h2>
              {planOutcome ? (
                <ConclusionBadge
                  label={planOutcome.kind === "conclusion" ? planOutcome.label : "not_simulated"}
                  testId="plan-label-badge"
                />
              ) : (
                <ConclusionBadge label="not_simulated" testId="plan-label-badge" />
              )}
            </div>
            <p className="text-xs text-slate-600 m-0 mt-0.5">{t("plan.subtitle")}</p>
          </div>

          {/* Khung câu truy vấn SELECT */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("plan.queryLabel")}
            </span>
            <div className="rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-800 break-all leading-relaxed max-h-20 overflow-hidden">
              {selectSql || (planData ? "/* Query execution plan */" : "--")}
            </div>
          </div>

          {/* AC6: Trạng thái rỗng khi không có Plan */}
          {!planData ? (
            <div
              className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center bg-slate-50/50 my-3"
              data-testid="plan-empty"
            >
              <ConclusionBadge label="not_simulated" className="mb-2" />
              <h3 className="text-sm font-bold text-slate-800 mb-1">
                {t("empty.title")}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm m-0">
                {t("empty.planDesc")}
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-between my-2 overflow-hidden gap-3">
              {/* Chỉ số thực thi tổng quan (Metrics Grid) */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  <span className="text-[10px] text-slate-500 block uppercase">
                    {t("plan.metrics.actualRows")}
                  </span>
                  <span className="text-sm font-bold font-mono text-slate-800">
                    {formatNumber(planData.root.actualRows, locale)}
                  </span>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  <span className="text-[10px] text-slate-500 block uppercase">
                    {t("plan.metrics.estimatedRows")}
                  </span>
                  <span className="text-sm font-bold font-mono text-slate-800">
                    {formatNumber(planData.root.estimatedRows, locale)}
                  </span>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  <span className="text-[10px] text-slate-500 block uppercase">
                    {t("plan.metrics.pagesRead")}
                  </span>
                  <span className="text-sm font-bold font-mono text-slate-800">
                    {formatNumber(planData.root.pagesRead, locale)}
                  </span>
                </div>
              </div>

              {/* Bảng các bước thực thi (Plan Execution Steps) */}
              <div className="overflow-hidden rounded border border-slate-200 flex-1">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-1.5 px-2.5 w-[42%]">{t("plan.colStep")}</th>
                      <th className="py-1.5 px-2.5 w-[33%]">{t("plan.colDetails")}</th>
                      <th className="py-1.5 px-2.5 w-[25%]">{t("plan.colRows")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                    {flatPlanNodes.slice(0, 8).map(({ node, depth }, idx) => (
                      <tr key={node.id || idx} className="avoid-break bg-white">
                        <td className="py-1.5 px-2.5 align-top">
                          <span
                            style={{ paddingLeft: `${depth * 14}px` }}
                            className="inline-block font-semibold text-slate-900 break-words"
                          >
                            {depth > 0 ? "↳ " : ""}
                            {node.label || node.kind}
                            {node.table ? ` on ${node.table}` : ""}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 align-top text-slate-600 font-sans text-[10.5px]">
                          {node.condition && (
                            <span className="block truncate max-w-[180px]">
                              Cond: {node.condition}
                            </span>
                          )}
                          {node.filter && (
                            <span className="block truncate max-w-[180px] text-amber-700">
                              Filter: {node.filter}
                            </span>
                          )}
                          {!node.condition && !node.filter && "--"}
                        </td>
                        <td className="py-1.5 px-2.5 align-top text-slate-700">
                          {formatNumber(node.actualRows, locale)} /{" "}
                          {formatNumber(node.estimatedRows, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>

        {/* Footer trang 3 (AC5) */}
        <footer className="report-page-footer">
          <p className="m-0 text-slate-500 max-w-[80%]">{t("disclaimer")}</p>
          <span className="font-semibold text-slate-700 shrink-0">{t("branding")}</span>
        </footer>
      </section>
    </div>
  );
}
