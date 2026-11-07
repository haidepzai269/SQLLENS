import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

// In danh sách test chỉ đạt sau khi chạy lại (flaky) ở cuối log CI, kèm lỗi lần đầu.
export default class FlakyReporter implements Reporter {
  private flaky: string[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === "passed" && result.retry > 0)
      this.flaky.push(`${test.location.file.split(/[\/]/).pop()}:${test.location.line} ${test.titlePath().slice(2).join(" › ")}`);
  }
  onEnd() {
    if (!this.flaky.length) return;
    console.log(`\n##[warning]FLAKY: ${this.flaky.length} test chỉ đạt sau khi chạy lại\n${this.flaky.map((f) => `  - ${f}`).join("\n")}\n`);
  }
}
