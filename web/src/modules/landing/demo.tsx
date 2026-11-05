"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { h2Style } from "./shell";

// Video quay từ sản phẩm thật bằng e2e/record-demo.ts. Tải lười, tự phát không tiếng khi vào màn hình, có nút dừng.
export function Demo() {
  const t = useTranslations("landing.demo");
  const locale = useLocale();
  const video = useRef<HTMLVideoElement>(null);
  const userPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false); // poster che khung đầu trắng của video cho đến khi video thật sự chạy
  const [failed, setFailed] = useState(false);
  const src = `/about/demo-${locale}`;

  useEffect(() => {
    const v = video.current;
    if (!v || matchMedia("(prefers-reduced-motion: reduce)").matches) return; // giảm chuyển động: không tự phát
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return v.pause();
        if (!userPaused.current) v.play().catch(() => {}); // trình duyệt chặn thì giữ poster, người xem bấm phát
      },
      { threshold: 0.4 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [locale, failed]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    userPaused.current = !v.paused;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <section aria-labelledby="demo-h" className="bg-stage py-20 md:py-28">
      <div className="flex flex-col gap-8 md:gap-10">
        <div className="px-[var(--pg)]">
          <h2 id="demo-h" className="text-text" style={h2Style}>{t("title")}</h2>
          <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-ink2 md:text-lg">{t("lead")}</p>
          {!failed && (
            <button type="button" onClick={toggle} className="mt-6 min-h-11 rounded-[2px] bg-raised px-5 text-[15px] font-semibold transition-colors duration-[180ms] hover:bg-control">
              {playing ? t("pause") : t("play")}
            </button>
          )}
        </div>
        <div className="px-[var(--pg)]">
          <div className="relative aspect-video w-full bg-ground">
            {failed ? (
              // eslint-disable-next-line @next/next/no-img-element -- poster tĩnh trong public/, không cần trình tối ưu
              <img src={`${src}.jpg`} alt={t("alt")} width={1600} height={900} className="size-full object-cover" />
            ) : (
              <video
                ref={video}
                muted
                loop
                playsInline
                preload="none"
                poster={`${src}.jpg`}
                aria-label={t("alt")}
                onPlay={() => setPlaying(true)}
                onPlaying={() => setStarted(true)}
                onPause={() => setPlaying(false)}
                onError={() => setFailed(true)}
                className="size-full object-cover"
              >
                <source src={`${src}.webm`} type="video/webm" onError={() => setFailed(true)} />
              </video>
            )}
            {!failed && !started && (
              // eslint-disable-next-line @next/next/no-img-element -- poster tĩnh trong public/
              <img src={`${src}.jpg`} alt="" aria-hidden width={1600} height={900} className="pointer-events-none absolute inset-0 size-full object-cover" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
