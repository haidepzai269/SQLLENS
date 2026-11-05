import { gsap } from "./gsap-setup";

// Danh sách bước của một cảnh: bước đang chạy rõ nhất. Điện thoại chồng các bước lên nhau và chỉ hiện bước hiện tại.
export function prepSteps(ol: HTMLElement, narrow: boolean) {
  const lis = [...ol.children] as HTMLElement[];
  if (narrow) ol.classList.add("is-stacked");
  const dim = narrow ? 0 : 0.5;
  gsap.set(lis, { opacity: narrow ? 0 : 0.3 });
  gsap.set(lis[0], { opacity: 1 });
  return { lis, dim, undo: () => ol.classList.remove("is-stacked") };
}

export function fadeSteps(tl: gsap.core.Timeline, lis: HTMLElement[], dim: number, times: number[]) {
  lis.forEach((li, i) => {
    if (i) tl.to(li, { opacity: 1, duration: 0.2 }, times[i]);
    if (i < lis.length - 1) tl.to(li, { opacity: dim, duration: 0.2 }, times[i + 1] - 0.1);
  });
}
