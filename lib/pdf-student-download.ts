import type { summarizeStudentRecords } from "./grade.ts";

export async function downloadStudentTrendPdf(studentName: string, contextLabel: string, summary: ReturnType<typeof summarizeStudentRecords>): Promise<void> {
  const [{ createStudentTrendPdf }, fontResponse] = await Promise.all([
    import("./pdf-student"),
    fetch("/fonts/NotoSansHK-Regular.otf", { cache: "force-cache" }),
  ]);
  if (!fontResponse.ok) throw new Error("未能載入中文字體");
  const bytes = await createStudentTrendPdf(studentName, contextLabel, summary, new Uint8Array(await fontResponse.arrayBuffer()));
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${studentName}_考試趨勢.pdf`.replace(/[\\/:*?"<>|]/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
