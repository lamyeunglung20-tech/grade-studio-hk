import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { LEVELS, type StudentTrendRecord, type summarizeStudentRecords } from "./grade.ts";

type Summary = ReturnType<typeof summarizeStudentRecords>;
type ChartMetric = "score" | "grade";

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 42;
const RIGHT = WIDTH - MARGIN;
const GREEN = rgb(0.13, 0.35, 0.28);
const DARK = rgb(0.14, 0.21, 0.17);
const MUTED = rgb(0.42, 0.49, 0.43);
const LINE = rgb(0.86, 0.90, 0.86);
const PALE = rgb(0.94, 0.97, 0.94);
const WHITE = rgb(1, 1, 1);
const ROWS_PER_PAGE = 8;

const level = (value: string) => value === "U" ? "U" : `Lv${value}`;
const overallLevel = (summary: Summary) => !summary.overall ? "待有考試等級" : summary.overall.lower === summary.overall.upper
  ? level(summary.overall.lower) : `${level(summary.overall.lower)}-${level(summary.overall.upper)}`;

function fitted(value: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  let text = value;
  while (text && font.widthOfTextAtSize(`${text}…`, size) > width) text = text.slice(0, -1);
  return `${text}…`;
}

function drawMetric(page: PDFPage, font: PDFFont, x: number, top: number, label: string, value: string, caption: string, emphasized = false) {
  const boxWidth = (RIGHT - MARGIN - 12) / 2;
  page.drawRectangle({ x, y: top - 67, width: boxWidth, height: 67, color: emphasized ? GREEN : PALE });
  const valueColor = emphasized ? WHITE : GREEN;
  page.drawText(label, { x: x + 13, y: top - 18, font, size: 9, color: emphasized ? PALE : MUTED });
  page.drawText(fitted(value, font, 22, boxWidth - 26), { x: x + 13, y: top - 44, font, size: 22, color: valueColor });
  page.drawText(caption, { x: x + 13, y: top - 59, font, size: 8, color: emphasized ? PALE : MUTED });
}

function drawChart(page: PDFPage, font: PDFFont, latin: PDFFont, group: StudentTrendRecord[], offset: number, top: number, metric: ChartMetric) {
  const label = metric === "score" ? "分數趨勢" : "預測等級趨勢";
  page.drawText(label, { x: MARGIN, y: top, font, size: 11, color: DARK });
  const plotLeft = 96, plotRight = RIGHT - 11, plotTop = top - 22, plotBottom = top - 118;
  const ticks = metric === "score" ? [0, 25, 50, 75, 100] : LEVELS.map((_, index) => index);
  const maximum = metric === "score" ? 100 : LEVELS.length - 1;
  const yAt = (value: number) => plotBottom + value / maximum * (plotTop - plotBottom);
  for (const tick of ticks) {
    const y = yAt(tick);
    page.drawLine({ start: { x: plotLeft, y }, end: { x: plotRight, y }, thickness: tick === 0 ? 0.8 : 0.45, color: LINE });
    const text = metric === "score" ? String(tick) : level(LEVELS[tick]);
    page.drawText(text, { x: plotLeft - 9 - font.widthOfTextAtSize(text, 8), y: y - 3, font, size: 8, color: MUTED });
  }
  const xAt = (index: number) => group.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + index * (plotRight - plotLeft) / (group.length - 1);
  let prior: { x: number; y: number } | null = null;
  let validCount = 0;
  group.forEach((record, index) => {
    const x = xAt(index);
    const value = metric === "score" ? record.score : record.gradeIndex;
    page.drawText(String(offset + index + 1), { x: x - latin.widthOfTextAtSize(String(offset + index + 1), 8) / 2, y: plotBottom - 16, font: latin, size: 8, color: MUTED });
    if (value === null) { prior = null; return; }
    validCount++;
    const y = yAt(value);
    if (prior) page.drawLine({ start: prior, end: { x, y }, thickness: 2.4, color: GREEN });
    page.drawCircle({ x, y, size: 4, borderWidth: 1.7, borderColor: GREEN, color: WHITE });
    prior = { x, y };
  });
  if (!validCount) page.drawText(metric === "score" ? "尚未有有效分數" : "尚未有可用的預測等級", { x: plotLeft + 90, y: (plotTop + plotBottom) / 2, font, size: 10, color: MUTED });
}

function displayScore(record: StudentTrendRecord): string {
  if (record.kind === "abs") return "ABS";
  if (record.kind === "invalid") return "無效";
  return record.score === null ? "—" : String(record.score);
}

function displayGrade(record: StudentTrendRecord): string {
  if (record.gradeIndex !== null) return level(record.grade);
  return record.kind === "valid" ? "待設定" : "—";
}

function drawTable(page: PDFPage, font: PDFFont, latin: PDFFont, group: StudentTrendRecord[], offset: number) {
  const top = 292;
  page.drawText("考試紀錄", { x: MARGIN, y: top, font, size: 11, color: DARK });
  page.drawRectangle({ x: MARGIN, y: top - 31, width: RIGHT - MARGIN, height: 23, color: PALE });
  const columns = [MARGIN + 7, MARGIN + 40, MARGIN + 246, MARGIN + 363, MARGIN + 421];
  ["序", "考試", "班別", "分數", "預測等級"].forEach((heading, index) =>
    page.drawText(heading, { x: columns[index], y: top - 23, font, size: 8, color: GREEN }));
  group.forEach((record, index) => {
    const y = top - 31 - index * 22;
    if (index % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - 22, width: RIGHT - MARGIN, height: 22, color: rgb(0.985, 0.99, 0.985) });
    page.drawText(String(offset + index + 1), { x: columns[0], y: y - 15, font: latin, size: 8, color: MUTED });
    page.drawText(fitted(record.name, font, 8, 197), { x: columns[1], y: y - 15, font, size: 8, color: DARK });
    page.drawText(fitted(record.className ?? "—", font, 8, 108), { x: columns[2], y: y - 15, font, size: 8, color: DARK });
    page.drawText(displayScore(record), { x: columns[3], y: y - 15, font, size: 8, color: DARK });
    page.drawText(displayGrade(record), { x: columns[4], y: y - 15, font, size: 8, color: GREEN });
    page.drawLine({ start: { x: MARGIN, y: y - 22 }, end: { x: RIGHT, y: y - 22 }, thickness: 0.4, color: LINE });
  });
  if (!group.length) page.drawText("尚未建立考試紀錄。", { x: MARGIN + 8, y: top - 54, font, size: 9, color: MUTED });
}

/** A student's own records are the only data passed to this function. */
export async function createStudentTrendPdf(studentName: string, contextLabel: string, summary: Summary, fontBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const latin = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(`${studentName} - 學生趨勢報告`);
  pdf.setAuthor("成績分析室");
  pdf.setSubject("個人成績趨勢與預測等級");
  const groups = summary.records.length
    ? Array.from({ length: Math.ceil(summary.records.length / ROWS_PER_PAGE) }, (_, index) => summary.records.slice(index * ROWS_PER_PAGE, (index + 1) * ROWS_PER_PAGE))
    : [[] as StudentTrendRecord[]];
  groups.forEach((group, pageIndex) => {
    const page = pdf.addPage([WIDTH, HEIGHT]);
    page.drawText("成績分析室  /  個人報告", { x: MARGIN, y: HEIGHT - MARGIN, font, size: 9, color: GREEN });
    page.drawText("學生考試趨勢", { x: MARGIN, y: HEIGHT - 75, font, size: 20, color: DARK });
    page.drawText(fitted(`${studentName}  /  ${contextLabel}`, font, 10, RIGHT - MARGIN), { x: MARGIN, y: HEIGHT - 98, font, size: 10, color: MUTED });
    page.drawText(`考試 ${pageIndex * ROWS_PER_PAGE + (group.length ? 1 : 0)}-${pageIndex * ROWS_PER_PAGE + group.length} / 共 ${summary.records.length} 次`, { x: MARGIN, y: HEIGHT - 115, font, size: 9, color: MUTED });
    page.drawLine({ start: { x: MARGIN, y: HEIGHT - 128 }, end: { x: RIGHT, y: HEIGHT - 128 }, thickness: 1.4, color: GREEN });
    const metricTop = HEIGHT - 144;
    drawMetric(page, font, MARGIN, metricTop, "多次考試平均分", summary.average === null ? "—" : summary.average.toFixed(2), `${summary.scoreCount} 次有效分數`, true);
    drawMetric(page, font, MARGIN + (RIGHT - MARGIN - 12) / 2 + 12, metricTop, "總預測等級", overallLevel(summary), `${summary.gradedCount} 次有預測等級`);
    page.drawText("總預測按最近最多 5 次有等級考試加權；平均分只計有效分數，缺考不計。", { x: MARGIN, y: metricTop - 82, font, size: 8, color: MUTED });
    drawChart(page, font, latin, group, pageIndex * ROWS_PER_PAGE, 580, "score");
    drawChart(page, font, latin, group, pageIndex * ROWS_PER_PAGE, 438, "grade");
    drawTable(page, font, latin, group, pageIndex * ROWS_PER_PAGE);
    const footer = `${pageIndex + 1} / ${groups.length}`;
    page.drawText(footer, { x: RIGHT - latin.widthOfTextAtSize(footer, 8), y: 27, font: latin, size: 8, color: MUTED });
  });
  return pdf.save();
}
