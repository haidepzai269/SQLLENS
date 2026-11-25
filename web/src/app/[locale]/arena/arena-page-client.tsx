"use client";

import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/modules/auth/auth-provider";
import type { ArenaRole } from "@/modules/arena/arena-sync";
import { ArenaView } from "@/modules/arena/components/arena-view";

function parseRoomId(raw: string | null): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function parseArenaRole(raw: string | null): ArenaRole | undefined {
  return raw === "host" || raw === "viewer" ? raw : undefined;
}

export function ArenaPageClient() {
  const t = useTranslations("arena");
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const roomId = parseRoomId(searchParams.get("roomId"));
  const role = parseArenaRole(searchParams.get("role"));
  const isVip = Boolean(user?.isVip || user?.role === "vip");

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-background">
      <div className="mx-auto flex w-full max-w-5xl items-center px-3 pt-3 sm:px-6 sm:pt-4">
        <Link
          href="/"
          data-testid="arena-back-to-lab"
          className={`${buttonVariants({ variant: "outline", size: "sm" })} min-h-10 gap-1.5`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span>{t("nav.backToLab")}</span>
        </Link>
      </div>
      <ArenaView roomId={roomId} role={role} isVip={isVip} />
    </main>
  );
}
