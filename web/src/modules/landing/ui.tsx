import { Link } from "@/i18n/navigation";

export const btnBase = "inline-flex min-h-12 items-center justify-center rounded-[2px] px-6 text-base font-semibold transition-[transform,background-color] duration-[180ms] ease-out active:translate-y-px motion-reduce:transition-none";
export const btnPrimary = `${btnBase} bg-lamp text-lamp-ink hover:bg-[#ffcb66]`;
export const btnQuiet = `${btnBase} bg-raised text-text hover:bg-control`;

// Hai đường vào sản phẩm: màn hình chính, và cổng đăng nhập (mở engine MySQL khi chưa đăng nhập).
export function ProductLink({ label, className = btnPrimary }: { label: string; className?: string }) {
  return <Link href="/" className={className}>{label}</Link>;
}
export function LoginLink({ label, className = btnQuiet }: { label: string; className?: string }) {
  return <Link href={{ pathname: "/", query: { engine: "mysql" } }} className={className}>{label}</Link>;
}

// Nhãn kết luận theo DESIGN.md: khác nhau ở chữ, ký hiệu, nền và kiểu viền, không chỉ ở màu.
export function Tag({ kind, children }: { kind: "real" | "sim" | "est"; children: React.ReactNode }) {
  const look = {
    real: "bg-label-real text-label-real-foreground",
    sim: "border border-solid border-ink2 text-ink2",
    est: "border border-dashed border-ink2 text-ink2 italic",
  }[kind];
  return (
    <span data-ui className={`inline-flex items-center gap-2 rounded-[2px] px-2.5 py-1 text-[13px] font-semibold leading-5 ${look}`}>
      <svg viewBox="0 0 12 12" aria-hidden className="size-3">
        {kind === "real" && <circle cx="6" cy="6" r="5" fill="currentColor" />}
        {kind === "sim" && (<><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M6 1.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" /></>)}
        {kind === "est" && <path d="M1 4.5q2.5-3 5 0t5 0M1 8.5q2.5-3 5 0t5 0" fill="none" stroke="currentColor" strokeWidth="1.2" />}
      </svg>
      {children}
    </span>
  );
}
