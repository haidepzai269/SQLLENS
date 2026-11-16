"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Folder,
  Pencil,
  Plus,
  Trash2,
  X,
  AlertTriangle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/modules/workspace/store";
import type { WorkspaceProject } from "@/modules/workspace/types";

interface ProjectSwitcherProps {
  className?: string;
}

export function ProjectSwitcher({ className }: ProjectSwitcherProps) {
  const t = useTranslations("workspace");
  const locale = useLocale();
  const titleId = useId();

  const projects = useWorkspaceStore((s) => s.projects);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);
  const createProject = useWorkspaceStore((s) => s.createProject);
  const renameProject = useWorkspaceStore((s) => s.renameProject);
  const duplicateProject = useWorkspaceStore((s) => s.duplicateProject);
  const deleteProject = useWorkspaceStore((s) => s.deleteProject);

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const currentProject = useMemo(() => {
    if (!activeProjectId) {
      return projects.length > 0 ? projects[0] : null;
    }
    return projects.find((p) => p.id === activeProjectId) ?? (projects.length > 0 ? projects[0] : null);
  }, [projects, activeProjectId]);

  const formatDate = (timestamp: number) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(timestamp));
    } catch {
      return new Date(timestamp).toLocaleDateString();
    }
  };

  const closeMenu = () => {
    setIsOpen(false);
    setIsCreating(false);
    setNewProjectName("");
    setEditingProjectId(null);
    setEditingName("");
    setDeletingProjectId(null);
  };

  // Đóng khi click ngoài container
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  // Bắt phím Escape toàn cục khi menu mở
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Auto focus khi mở form tạo mới
  useEffect(() => {
    if (isCreating) {
      createInputRef.current?.focus();
    }
  }, [isCreating]);

  // Auto focus khi mở form đổi tên
  useEffect(() => {
    if (editingProjectId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingProjectId]);

  const handleTriggerClick = () => {
    if (isOpen) {
      closeMenu();
    } else {
      setIsOpen(true);
    }
  };

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  const handleSelectProject = (id: string) => {
    setActiveProject(id);
    closeMenu();
    triggerRef.current?.focus();
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setNewProjectName("");
    setEditingProjectId(null);
    setDeletingProjectId(null);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setNewProjectName("");
  };

  const handleSaveCreate = () => {
    const trimmed = newProjectName.trim();
    const finalName = trimmed || t("project.untitled");
    createProject({ name: finalName, engine: "postgres" });
    closeMenu();
    triggerRef.current?.focus();
  };

  const handleStartRename = (e: React.MouseEvent, project: WorkspaceProject) => {
    e.stopPropagation();
    setEditingProjectId(project.id);
    setEditingName(project.name);
    setDeletingProjectId(null);
  };

  const handleCancelRename = () => {
    setEditingProjectId(null);
    setEditingName("");
  };

  const handleSaveRename = (projectId: string, currentName: string) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== currentName) {
      renameProject(projectId, trimmed);
    }
    setEditingProjectId(null);
    setEditingName("");
  };

  const handleDuplicate = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    duplicateProject(projectId, t("project.copySuffix"));
    closeMenu();
    triggerRef.current?.focus();
  };

  const handleStartDelete = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setDeletingProjectId(projectId);
    setEditingProjectId(null);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingProjectId(null);
  };

  const handleConfirmDelete = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    deleteProject(projectId);
    setDeletingProjectId(null);
  };

  return (
    <div ref={containerRef} className={cn("relative inline-block text-left", className)}>
      {/* Nút trigger */}
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t("project.switcher")}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className="h-8 max-w-[200px] gap-1.5 px-2.5 font-normal sm:max-w-[260px]"
        data-testid="project-switcher-trigger"
      >
        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-left text-sm font-medium">
          {currentProject ? currentProject.name : t("project.untitled")}
        </span>
        {currentProject && (
          <Badge
            variant="secondary"
            className="hidden h-4 px-1 text-[10px] font-normal tracking-tight uppercase sm:inline-flex"
          >
            {currentProject.engine === "mysql" ? "MySQL" : "PG"}
          </Badge>
        )}
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </Button>

      {/* Menu / Dropdown / Sheet */}
      {isOpen && (
        <>
          {/* Lớp nền mờ trên mobile để biến menu thành dạng sheet */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs sm:hidden"
            onClick={closeMenu}
            data-testid="project-switcher-backdrop"
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="project-switcher-panel"
            className={cn(
              "z-50 flex flex-col bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none",
              // Mobile: Bottom sheet
              "fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t p-2",
              // Desktop: Popover dropdown
              "sm:absolute sm:inset-auto sm:top-full sm:left-0 sm:mt-1.5 sm:max-h-[460px] sm:w-88 sm:max-w-[calc(100vw-2rem)] sm:rounded-xl sm:border sm:p-2"
            )}
          >
            {/* Header: Tiêu đề & Nút Thêm mới */}
            <div className="flex items-center justify-between border-b pb-2 px-1">
              <span id={titleId} className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("project.switcher")}
              </span>
              {!isCreating && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={handleStartCreate}
                  className="h-6 gap-1 px-1.5 text-xs text-primary hover:text-primary"
                  data-testid="project-new-button"
                >
                  <Plus className="size-3.5" />
                  <span>{t("project.new")}</span>
                </Button>
              )}
            </div>

            {/* Khung tạo dự án mới */}
            {isCreating && (
              <div className="my-2 rounded-lg border bg-muted/40 p-2" data-testid="project-create-form">
                <Input
                  ref={createInputRef}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder={t("project.namePlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveCreate();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      handleCancelCreate();
                    }
                  }}
                  className="h-7 text-xs"
                  data-testid="project-name-input"
                />
                <div className="mt-2 flex justify-end gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={handleCancelCreate}
                    data-testid="project-cancel-create"
                  >
                    {t("project.cancel")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="default"
                    onClick={handleSaveCreate}
                    data-testid="project-save-create"
                  >
                    {t("project.create")}
                  </Button>
                </div>
              </div>
            )}

            {/* Danh sách dự án */}
            <div className="mt-1 flex-1 overflow-y-auto max-h-[300px] space-y-1 pr-0.5">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-muted-foreground">
                  <Folder className="mb-2 size-8 stroke-1 text-muted-foreground/60" />
                  <p className="font-medium">{t("project.empty")}</p>
                  {!isCreating && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={handleStartCreate}
                      className="mt-3 gap-1"
                      data-testid="project-empty-cta"
                    >
                      <Plus className="size-3" />
                      {t("project.create")}
                    </Button>
                  )}
                </div>
              ) : (
                projects.map((p) => {
                  const isActive = p.id === currentProject?.id;
                  const isEditing = editingProjectId === p.id;
                  const isDeleting = deletingProjectId === p.id;

                  if (isDeleting) {
                    return (
                      <div
                        key={p.id}
                        className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs"
                        data-testid={`project-delete-confirm-${p.id}`}
                      >
                        <div className="flex items-start gap-1.5 text-destructive font-medium">
                          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                          <span className="leading-tight">{t("project.deleteConfirm")}</span>
                        </div>
                        <div className="mt-2 flex justify-end gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={handleCancelDelete}
                            data-testid={`project-cancel-delete-${p.id}`}
                          >
                            {t("project.cancel")}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="destructive"
                            onClick={(e) => handleConfirmDelete(e, p.id)}
                            data-testid={`project-confirm-delete-${p.id}`}
                          >
                            {t("project.delete")}
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  if (isEditing) {
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-1.5 rounded-lg border bg-muted/40 p-1.5"
                        data-testid={`project-rename-form-${p.id}`}
                      >
                        <Input
                          ref={renameInputRef}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveRename(p.id, p.name);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              handleCancelRename();
                            }
                          }}
                          className="h-7 flex-1 text-xs"
                          data-testid={`project-rename-input-${p.id}`}
                        />
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => handleSaveRename(p.id, p.name)}
                          aria-label={t("project.save")}
                          data-testid={`project-save-rename-${p.id}`}
                        >
                          <Check className="size-3.5 text-primary" />
                        </Button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={handleCancelRename}
                          aria-label={t("project.cancel")}
                          data-testid={`project-cancel-rename-${p.id}`}
                        >
                          <X className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectProject(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelectProject(p.id);
                        }
                      }}
                      className={cn(
                        "group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer select-none transition-colors outline-none",
                        isActive
                          ? "bg-accent/80 font-medium text-accent-foreground"
                          : "hover:bg-muted text-foreground"
                      )}
                      data-testid={`project-item-${p.id}`}
                    >
                      {/* Cột trái: Tên, Engine, Thời gian */}
                      <div className="flex flex-1 min-w-0 items-center gap-2">
                        {isActive ? (
                          <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                        ) : (
                          <div className="size-3.5 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium" title={p.name}>
                              {p.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="h-3.5 px-1 text-[9px] font-normal uppercase"
                            >
                              {p.engine === "mysql" ? "MySQL" : "PG"}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {t("project.updatedAt", { time: formatDate(p.updatedAt) })}
                          </div>
                        </div>
                      </div>

                      {/* Cột phải: Các nút hành động (Đổi tên, Nhân bản, Xóa) */}
                      <div className="flex items-center gap-0.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={(e) => handleStartRename(e, p)}
                          aria-label={t("project.rename")}
                          title={t("project.rename")}
                          data-testid={`project-rename-btn-${p.id}`}
                        >
                          <Pencil className="size-3 text-muted-foreground hover:text-foreground" />
                        </Button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={(e) => handleDuplicate(e, p.id)}
                          aria-label={t("project.duplicate")}
                          title={t("project.duplicate")}
                          data-testid={`project-duplicate-btn-${p.id}`}
                        >
                          <Copy className="size-3 text-muted-foreground hover:text-foreground" />
                        </Button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={(e) => handleStartDelete(e, p.id)}
                          aria-label={t("project.delete")}
                          title={t("project.delete")}
                          data-testid={`project-delete-btn-${p.id}`}
                        >
                          <Trash2 className="size-3 text-destructive/80 hover:text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
