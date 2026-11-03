/* eslint-disable react/jsx-no-literals -- route thử của Playwright, không phải giao diện sản phẩm */
"use client";

import { useState } from "react";
import { SampleButton } from "@/components/sql-editor/sample-button";
import { SqlEditor } from "@/components/sql-editor/sql-editor";
import type { EngineId } from "@/contracts/engine";

export function Harness() {
  const [value, setValue] = useState("SELECT 1;");
  const [engine, setEngine] = useState<EngineId>("postgres");
  const [changes, setChanges] = useState(0);
  const [pos, setPos] = useState("");
  const [error, setError] = useState<{ position: number; message: string } | undefined>();
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setEngine("postgres")}>pg</button>
        <button onClick={() => setEngine("mysql")}>my</button>
        <SampleButton engine={engine} onLoad={setValue} />
        <button onClick={() => setValue("SELECT 1;\r\nSELECT 2;\r\nSELECT 3 FROM <b>x</b>;")}>crlf</button>
        <input aria-label="pos" value={pos} onChange={(e) => setPos(e.target.value)} className="w-20 border text-foreground" />
        <button onClick={() => setError({ position: Number(pos), message: "Lỗi <b>thử</b> ở đây" })}>mark</button>
        <button onClick={() => setError(undefined)}>clear</button>
        <span data-testid="changes">{changes}</span>
        <span data-testid="engine">{engine}</span>
      </div>
      <div className="h-64 border border-line">
        <SqlEditor
          value={value}
          onChange={(v) => {
            setValue(v);
            setChanges((n) => n + 1);
          }}
          engine={engine}
          error={error}
          ariaLabel="SQL"
        />
      </div>
      <button>ngoài</button>
    </main>
  );
}
