"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useBatonStore } from "@/modules/room/collab/baton-store";

/**
 * Thanh thông báo và nút điều phối The Baton trong phòng cộng tác:
 * - Editor khác giữ Baton: hiển thị nút Xin quyền chạy (hoặc trạng thái đã gửi).
 * - Chính mình giữ Baton và có người xin: liệt kê danh sách kèm nút Cấp quyền.
 * - Vai trò viewer hoặc ngoài phòng cộng tác: không hiển thị.
 */
export function BatonRequestToast() {
  const t = useTranslations("room.baton");
  const projectId = useBatonStore((s) => s.projectId);
  const holderId = useBatonStore((s) => s.holderId);
  const myUserId = useBatonStore((s) => s.myUserId);
  const myRole = useBatonStore((s) => s.myRole);
  const memberNames = useBatonStore((s) => s.memberNames);
  const pendingRequests = useBatonStore((s) => s.pendingRequests);
  const requestBaton = useBatonStore((s) => s.requestBaton);
  const grantBaton = useBatonStore((s) => s.grantBaton);

  if (projectId === null || myRole === "viewer" || myRole === null) {
    return null;
  }

  const isHolder = myUserId !== null && holderId === myUserId;

  if (!isHolder) {
    const holderName = holderId ? (memberNames[holderId] ?? t("unknownMember")) : null;
    const alreadyRequested = myUserId !== null && pendingRequests.includes(myUserId);
    return (
      <div
        role="status"
        data-testid="baton-request-bar"
        className="flex flex-wrap items-center justify-between gap-2 border border-line bg-raised px-2.5 py-1.5 text-xs"
      >
        <span className="min-w-0 break-words text-muted-foreground">
          {holderName ? t("holderLabel", { name: holderName }) : t("blockedTooltipUnknown")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 shrink-0 px-2 text-xs"
          data-testid="baton-request-button"
          disabled={alreadyRequested}
          onClick={() => void requestBaton()}
        >
          {alreadyRequested ? t("requestPending") : t("requestButton")}
        </Button>
      </div>
    );
  }

  const requesters = pendingRequests.filter((uid) => uid !== myUserId);
  if (requesters.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="baton-request-toast"
      className="flex flex-col gap-1.5 border border-line bg-raised px-2.5 py-1.5 text-xs"
    >
      {requesters.map((uid) => {
        const name = memberNames[uid] ?? t("unknownMember");
        return (
          <div key={uid} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words">{t("requestMessage", { name })}</span>
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-6 shrink-0 px-2 text-xs"
              data-testid="baton-grant-button"
              onClick={() => void grantBaton(uid)}
            >
              {t("grantButton")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
