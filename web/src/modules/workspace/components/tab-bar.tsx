"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/modules/workspace/store";
import type { WorkspaceTab } from "@/modules/workspace/types";
import { ProjectSwitcher } from "./project-switcher";

interface TabBarProps {
  className?: string;
}

export function TabBar({ className }: TabBarProps) {
  const t = useTranslations("workspace");

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const projects = useWorkspaceStore((s) => s.projects);
  const createTab = useWorkspaceStore((s) => s.createTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const reorderTab = useWorkspaceStore((s) => s.reorderTab);

  const currentProjectId = activeProjectId ?? (projects.length > 0 ? projects[0].id : null);

  const tabs = useMemo(() => {
    if (!currentProjectId) return [];
    return allTabs
      .filter((tab) => tab.projectId === currentProjectId)
      .sort((a, b) => a.position - b.position);
  }, [allTabs, currentProjectId]);

  const isOnlyTab = tabs.length <= 1;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleSelectTab = (id: string) => {
    if (editingTabId) return;
    useWorkspaceStore.setState({ activeTabId: id });
  };

  const handleAddTab = () => {
    if (!currentProjectId) return;
    createTab(currentProjectId);
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          left: scrollRef.current.scrollWidth,
          behavior: "smooth",
        });
      }
    });
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (isOnlyTab) return;
    closeTab(id);
  };

  const handleStartRename = (e: React.MouseEvent, tab: WorkspaceTab) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditingName(tab.name);
  };

  const handleSaveRename = (tabId: string, currentName: string) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== currentName) {
      renameTab(tabId, trimmed);
    }
    setEditingTabId(null);
  };

  const handleCancelRename = () => {
    setEditingTabId(null);
  };

  const handleInputKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    tabId: string,
    currentName: string
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveRename(tabId, currentName);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelRename();
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (editingTabId) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggedTabId(id);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain") || draggedTabId;
    if (sourceId) {
      const fromIndex = tabs.findIndex((t) => t.id === sourceId);
      if (fromIndex !== -1 && fromIndex !== targetIndex) {
        reorderTab(sourceId, targetIndex);
      }
    }
    setDraggedTabId(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedTabId(null);
    setDragOverIndex(null);
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0 && scrollRef.current) {
      scrollRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div
      className={cn(
        "flex h-9 w-full max-w-full min-w-0 items-center border-b border-line bg-ground px-1.5 select-none font-sans text-xs",
        className
      )}
    >
      <div className="flex h-full items-center border-r border-line pr-1.5 mr-1 shrink-0">
        <ProjectSwitcher className="shrink-0" />
      </div>

      <div
        ref={scrollRef}
        role="tablist"
        aria-label={t("tab.list")}
        onWheel={handleWheel}
        className="flex h-full min-w-0 flex-1 items-end gap-1 overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isEditing = tab.id === editingTabId;
          const isDragging = tab.id === draggedTabId;
          const isDragOver = dragOverIndex === index && draggedTabId !== tab.id;

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              draggable={!isEditing}
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => handleSelectTab(tab.id)}
              onDoubleClick={(e) => handleStartRename(e, tab)}
              onKeyDown={(e) => {
                if (isEditing) return;
                // Nút đóng nằm trong tab: phím của nút không được bị tab "nuốt",
                // nếu không Space/Enter trên nút đóng lại chọn tab thay vì đóng.
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectTab(tab.id);
                }
              }}
              data-testid={`workspace-tab-${tab.id}`}
              className={cn(
                "group relative flex h-8 max-w-[200px] min-w-[90px] shrink-0 items-center justify-between gap-1.5 rounded-t-[var(--radius)] border border-b-0 px-2.5 transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp",
                isActive
                  ? "bg-surface text-text border-line font-medium shadow-xs before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-lamp"
                  : "bg-ground/70 text-dim border-transparent hover:bg-surface/50 hover:text-text",
                isDragging && "opacity-40",
                isDragOver && "border-l-2 border-l-lamp"
              )}
            >
              {isEditing ? (
                <input
                  type="text"
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => handleInputKeyDown(e, tab.id, tab.name)}
                  onBlur={() => handleSaveRename(tab.id, tab.name)}
                  onClick={(e) => e.stopPropagation()}
                  data-testid="tab-rename-input"
                  aria-label={t("tab.rename")}
                  className="h-5 w-full max-w-[130px] rounded-xs border border-lamp/80 bg-raised px-1 font-mono text-[11px] text-text outline-none focus:ring-1 focus:ring-lamp"
                />
              ) : (
                <span
                  title={tab.name}
                  className="truncate font-mono text-[11px] tracking-tight"
                >
                  {tab.name || t("tab.untitled")}
                </span>
              )}

              <button
                type="button"
                disabled={isOnlyTab}
                aria-disabled={isOnlyTab}
                aria-label={t("tab.close")}
                title={isOnlyTab ? t("tab.lastTabLocked") : t("tab.close")}
                onClick={(e) => handleCloseTab(e, tab.id)}
                data-testid={`tab-close-btn-${tab.id}`}
                className={cn(
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-xs transition-colors p-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp",
                  isOnlyTab
                    ? "cursor-not-allowed opacity-30 text-dim"
                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 text-dim hover:bg-line/70 hover:text-text"
                )}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleAddTab}
        aria-label={t("tab.add")}
        title={t("tab.add")}
        data-testid="tab-add-btn"
        className="ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-dim transition-colors hover:bg-surface hover:text-text border border-transparent hover:border-line focus:outline-none focus-visible:ring-1 focus-visible:ring-lamp"
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
