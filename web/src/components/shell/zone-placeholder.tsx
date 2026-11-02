// Nội dung giữ chỗ của một vùng: tiêu đề và câu trạng thái rỗng. Task sau thay bằng nội dung thật.
export function ZonePlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[var(--h-bar)] flex-none items-center border-b border-line px-[var(--edge)] font-semibold">{title}</div>
      <p className="p-[var(--edge)] text-dim">{hint}</p>
    </div>
  );
}
