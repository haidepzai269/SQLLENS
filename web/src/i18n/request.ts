import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

// Mỗi file messages/<locale>/<module>.json là một namespace, thêm module không cần sửa file dùng chung.
async function loadMessages(locale: string) {
  "use cache";
  const dir = path.join(process.cwd(), "messages", locale);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const entries = await Promise.all(
    files.map(async (f) => [f.slice(0, -5), JSON.parse(await readFile(path.join(dir, f), "utf8"))]),
  );
  return Object.fromEntries(entries);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: await loadMessages(locale) };
});
