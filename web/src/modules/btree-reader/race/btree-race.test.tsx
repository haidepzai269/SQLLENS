import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import viAnimMessages from "../../../../messages/vi/btree-anim.json";
import viTreeMessages from "../../../../messages/vi/btree.json";
import { BTreeRace } from "./btree-race";

afterEach(cleanup);

const messages = {
  "btree-anim": viAnimMessages,
  btree: viTreeMessages,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="vi" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("BTreeRace", () => {
  it("AC2: Hiển thị thanh cuộc đua đúng tỉ lệ số trang, số dòng", () => {
    renderWithIntl(
      <BTreeRace
        idxPages={4}
        seqPages={200}
        idxRows={10}
        seqRows={5000}
        label="real"
      />,
    );

    expect(screen.getByTestId("btree-race")).toBeTruthy();
    expect(screen.getByTestId("race-idx-pages").textContent).toContain("4 trang");
    expect(screen.getByTestId("race-seq-pages").textContent).toContain("200 trang");
    expect(screen.getByTestId("race-idx-rows").textContent).toContain("10 dòng");
    expect(screen.getByTestId("race-seq-rows").textContent).toContain("5.000 dòng");

    const idxBar = screen.getByTestId("race-bar-idx");
    const seqBar = screen.getByTestId("race-bar-seq");

    // Tỉ lệ: 4 / 200 = 2%
    expect(idxBar.style.width).toBe("2%");
    // Tỉ lệ: 200 / 200 = 100%
    expect(seqBar.style.width).toBe("100%");

    // Nhãn Thật
    const label = screen.getByTestId("race-label");
    expect(label.getAttribute("data-label")).toBe("real");
    expect(label.textContent).toContain("Thật");
  });

  it("AC1 & AC2: noIndex hiển thị rõ 'Không dùng được' và thanh Index Scan bằng 0", () => {
    renderWithIntl(
      <BTreeRace
        noIndex={true}
        idxPages={0}
        seqPages={180}
        idxRows={0}
        seqRows={1000}
        label="real"
      />,
    );

    expect(screen.getByTestId("btree-race").getAttribute("data-no-index")).toBe("true");
    expect(screen.getByTestId("race-no-index").textContent).toContain("Không dùng được");
    expect(screen.getByTestId("race-idx-pages").textContent).toContain("0 trang");
    expect(screen.getByTestId("race-bar-idx").style.width).toBe("0%");
    expect(screen.getByTestId("race-bar-seq").style.width).toBe("100%");
  });

  it("AC3: Tuyệt đối không hiển thị millisecond / microsecond / giây", () => {
    const { container } = renderWithIntl(
      <BTreeRace
        idxPages={3}
        seqPages={120}
        idxRows={5}
        seqRows={3000}
        label="real"
      />,
    );

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b\d+(\.\d+)?\s*(ms|µs|us|s|giây|second)\b/i);
    expect(text).not.toContain("mili-giây");
    expect(text).not.toContain("miligiây");

    // Dòng chú thích khẳng định so bằng số trang
    const note = screen.getByTestId("race-note");
    expect(note.textContent).toContain("So bằng số trang đọc, không phải thời gian. Thanh theo đúng tỷ lệ.");
  });

  it("Ca biên: Cả hai bằng 0 trang không bị NaN hay chia 0", () => {
    renderWithIntl(
      <BTreeRace
        idxPages={0}
        seqPages={0}
        idxRows={0}
        seqRows={0}
        label="real"
      />,
    );

    const idxBar = screen.getByTestId("race-bar-idx");
    const seqBar = screen.getByTestId("race-bar-seq");

    expect(idxBar.style.width).toBe("0%");
    expect(seqBar.style.width).toBe("0%");
    expect(screen.getByTestId("race-idx-pages").textContent).toContain("0 trang");
    expect(screen.getByTestId("race-seq-pages").textContent).toContain("0 trang");
  });

  it("Ca biên: Tỉ lệ chênh lệch cực lớn (1 trang vs 50.000 trang) vẫn có minWidth 4px", () => {
    renderWithIntl(
      <BTreeRace
        idxPages={1}
        seqPages={50000}
        label="real"
      />,
    );

    const idxBar = screen.getByTestId("race-bar-idx");
    expect(idxBar.style.minWidth).toBe("4px");
  });

  it("Hỗ trợ normalized label: sim -> simulated, est -> estimated", () => {
    const { rerender } = renderWithIntl(<BTreeRace label="sim" />);
    expect(screen.getByTestId("race-label").getAttribute("data-label")).toBe("simulated");

    rerender(
      <NextIntlClientProvider locale="vi" messages={messages}>
        <BTreeRace label="est" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("race-label").getAttribute("data-label")).toBe("estimated");
  });
});
