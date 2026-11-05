import type { Ref } from "react";

export const h2Style = { fontSize: "clamp(26px, 3.4vw, 52px)", lineHeight: 1.05, letterSpacing: "-0.03em", fontWeight: 600 } as const;

// Cảnh giữ màn hình: khung cao `vh`, phần trong dính đầu cửa sổ trong lúc cuộn qua khung.
export function Shell({ ref, id, bg, vh, title, lead, list, children }: {
  ref: Ref<HTMLElement>; id: string; bg: string; vh: number; title: string; lead: string; list: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section ref={ref} aria-labelledby={id} className={`relative ${bg}`} style={{ height: `${vh}svh` }}>
      <div className="sticky top-0 grid min-h-svh content-center gap-6 px-[var(--pg)] py-8 md:grid-cols-12 md:items-center md:gap-10">
        <div className="md:col-span-5">
          <h2 id={id} className="text-text" style={h2Style}>{title}</h2>
          <p className="mt-4 max-w-[44ch] text-base leading-relaxed text-ink2 md:text-lg">{lead}</p>
          {list}
        </div>
        <div className="mx-auto w-full max-w-[640px] md:col-span-7">{children}</div>
      </div>
    </section>
  );
}

export const olClass = "mt-6 flex max-w-[46ch] list-decimal flex-col gap-4 pl-6 text-base leading-relaxed text-text md:text-lg";
