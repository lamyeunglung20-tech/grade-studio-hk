import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { CUMULATIVE_LEVELS, cumulativeGradeCounts, LEVELS, rankStudentRows, type ClassRoom, type Exam, type analyze } from "./grade.ts";

type Report = ReturnType<typeof analyze>;
type Cell = { text: string; width: number };

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const GREEN = rgb(0.13, 0.35, 0.28);
const DARK = rgb(0.14, 0.21, 0.17);
const MUTED = rgb(0.41, 0.48, 0.42);
const LINE = rgb(0.86, 0.90, 0.86);
const PALE = rgb(0.94, 0.97, 0.94);
const YELLOW = rgb(1, 0.94, 0.67);
const AMBER = rgb(0.43, 0.31, 0);
const STUDENT_COLUMN_WIDTHS = [48, 202, 90, 171];

function pdfLevel(level: string): string {
  return level === "U" ? "U" : `Lv${level}`;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of text || "—") {
    if (char === "\n") { lines.push(line); line = ""; continue; }
    if (line && font.widthOfTextAtSize(line + char, size) > maxWidth) {
      lines.push(line);
      line = char;
    } else line += char;
  }
  lines.push(line);
  return lines;
}

function drawLines(page: PDFPage, lines: string[], x: number, top: number, font: PDFFont, size: number, color = DARK, step = size + 4) {
  lines.forEach((line, index) => page.drawText(line, { x, y: top - index * step, font, size, color }));
}

function metric(page: PDFPage, font: PDFFont, x: number, top: number, label: string, value: string, highlighted: boolean) {
  const width = (CONTENT_WIDTH - 24) / 4;
  page.drawRectangle({ x, y: top - 60, width, height: 60, color: highlighted ? GREEN : PALE });
  const color = highlighted ? rgb(1, 1, 1) : DARK;
  page.drawText(label, { x: x + 12, y: top - 19, font, size: 9, color: highlighted ? rgb(0.83, 0.91, 0.84) : MUTED });
  page.drawText(value, { x: x + 12, y: top - 45, font, size: 19, color });
}

function tableHeading(page: PDFPage, font: PDFFont, top: number, left = MARGIN) {
  page.drawRectangle({ x: left, y: top - 28, width: CONTENT_WIDTH, height: 28, color: PALE });
  const labels = ["排名", "學生姓名", "分數", "預測等級"];
  let x = left;
  labels.forEach((label, index) => {
    page.drawText(label, { x: x + 7, y: top - 18, font, size: 9, color: GREEN });
    x += STUDENT_COLUMN_WIDTHS[index];
  });
  return top - 28;
}

function rowCells(row: Report["detail"][number], rank: number | null, gradingReady: boolean): Cell[] {
  return [
    { text: rank === null ? "—" : String(rank), width: STUDENT_COLUMN_WIDTHS[0] },
    { text: row.student.name, width: STUDENT_COLUMN_WIDTHS[1] },
    { text: row.kind === "blank" ? "—" : row.raw, width: STUDENT_COLUMN_WIDTHS[2] },
    { text: row.kind === "invalid" ? "分數無效" : row.grade ? `${row.kind === "valid" ? pdfLevel(row.grade) : row.grade}${row.gapPercent === null ? "" : `\n距 ${pdfLevel(row.nextLevel)} 差 ${row.gapPercent}%`}` : row.kind === "valid" && !gradingReady ? "待設定" : "—", width: STUDENT_COLUMN_WIDTHS[3] },
  ];
}

function drawGradeStatisticsPage(pdf: PDFDocument, font: PDFFont, latinFont: PDFFont, klass: ClassRoom, exam: Exam, report: Report) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  page.drawText("成績分析室  /  考試報告", { x: MARGIN, y, font, size: 9, color: GREEN });
  y -= 32;
  page.drawText("預測等級統計", { x: MARGIN, y, font, size: 19, color: DARK });
  y -= 24;
  const title = `${klass.name}  /  ${exam.name}`;
  const titleLines = wrap(title, font, 10, CONTENT_WIDTH);
  drawLines(page, titleLines, MARGIN, y, font, 10, MUTED);
  y -= titleLines.length * 16 + 13;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.5, color: GREEN });
  y -= 27;
  const note = `有效分數：${report.count} 位；缺考及未填分數不計入比例。U 為該級比例，+ 代表該級或以上。`;
  const noteLines = wrap(note, font, 9, CONTENT_WIDTH);
  drawLines(page, noteLines, MARGIN, y, font, 9, MUTED);
  y -= noteLines.length * 14 + 20;
  if (!report.config.ready) {
    page.drawText("Grading 分界尚未設定，暫無等級統計。", { x: MARGIN, y, font, size: 11, color: MUTED });
    return;
  }

  page.drawRectangle({ x: MARGIN, y: y - 30, width: CONTENT_WIDTH, height: 30, color: PALE });
  for (const [label, x] of [["等級", 51], ["該級分佈", 112], ["人數", 365], ["該級比例", 445]] as const) {
    page.drawText(label, { x, y: y - 20, font, size: 9, color: GREEN });
  }
  y -= 30;
  const cumulative = cumulativeGradeCounts(report.grades);
  for (let i = 0; i < LEVELS.length; i++) {
    const height = 48;
    if (i % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: rgb(0.985, 0.99, 0.985) });
    const percent = report.count ? report.grades[i] / report.count * 100 : 0;
    page.drawText(pdfLevel(LEVELS[i]), { x: 51, y: y - 29, font: latinFont, size: 11, color: DARK });
    page.drawRectangle({ x: 112, y: y - 31, width: 220, height: 13, color: PALE });
    if (percent > 0) page.drawRectangle({ x: 112, y: y - 31, width: 220 * percent / 100, height: 13, color: rgb(0.49, 0.68, 0.51) });
    page.drawText(String(report.grades[i]), { x: 365, y: y - 29, font, size: 10, color: DARK });
    page.drawText(`${percent.toFixed(1)}%`, { x: 445, y: y - 29, font, size: 10, color: MUTED });
    page.drawLine({ start: { x: MARGIN, y: y - height }, end: { x: PAGE_WIDTH - MARGIN, y: y - height }, thickness: 0.5, color: LINE });
    y -= height;
  }

  y -= 28;
  const cellWidth = CONTENT_WIDTH / CUMULATIVE_LEVELS.length;
  page.drawRectangle({ x: MARGIN, y: y - 27, width: CONTENT_WIDTH, height: 27, color: PALE });
  page.drawRectangle({ x: MARGIN, y: y - 60, width: CONTENT_WIDTH, height: 33, color: rgb(0.985, 0.99, 0.985) });
  [...CUMULATIVE_LEVELS].reverse().forEach((level, index) => {
    const center = MARGIN + cellWidth * (index + 0.5);
    const label = pdfLevel(level);
    const originalIndex = CUMULATIVE_LEVELS.length - 1 - index;
    const percent = `${(report.count ? cumulative[originalIndex] / report.count * 100 : 0).toFixed(1)}%`;
    page.drawText(label, { x: center - latinFont.widthOfTextAtSize(label, 9) / 2, y: y - 18, font: latinFont, size: 9, color: GREEN });
    page.drawText(percent, { x: center - latinFont.widthOfTextAtSize(percent, 10) / 2, y: y - 48, font: latinFont, size: 10, color: DARK });
    if (index > 0) page.drawLine({ start: { x: MARGIN + cellWidth * index, y: y - 60 }, end: { x: MARGIN + cellWidth * index, y }, thickness: 0.5, color: LINE });
  });
  page.drawLine({ start: { x: MARGIN, y: y - 60 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 60 }, thickness: 0.5, color: LINE });
}

/** Put at most 20 student rows on each page, followed by grade statistics. */
export async function createGradeReportPdf(klass: ClassRoom, exam: Exam, report: Report, fontBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // The HK OpenType font must be embedded whole: fontkit's CFF subset renders incomplete glyphs.
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const latinFont = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(`${klass.name} - ${exam.name} - 成績報告`);
  pdf.setAuthor("成績分析室");
  pdf.setSubject("班別考試成績及預測等級");

  const classLines = wrap(klass.name, font, 19, CONTENT_WIDTH);
  const examLines = wrap(exam.name, font, 12, CONTENT_WIDTH);
  const notes = [
    `缺考 ABS：${report.absent} 位。平均分及比例只計算已輸入的有效分數。`,
    ...(!report.config.ready ? ["Grading 分界尚未設定，暫無預測等級。"] : []),
  ];
  const noteLines = notes.map(note => wrap(note, font, 9, CONTENT_WIDTH));
  const rows = rankStudentRows(report).map(({ row, rank }, index) => {
    const cells = rowCells(row, rank, report.config.ready);
    const lines = cells.map(cell => wrap(cell.text, font, 9, cell.width - 13));
    const height = Math.max(28, Math.max(...lines.map(parts => parts.length)) * 13 + 13);
    return { row, index, cells, lines, height };
  });

  const studentPages = Array.from({ length: Math.max(1, Math.ceil(rows.length / 20)) }, (_, index) => rows.slice(index * 20, (index + 1) * 20));
  const headerOffset = MARGIN + 29 + classLines.length * 23 + 7 + examLines.length * 17 + 19
    + 21 + 84 + noteLines.reduce((sum, lines) => sum + lines.length * 14, 0) + 11 + 14 + 28;
  const pageHeight = Math.max(PAGE_HEIGHT, headerOffset + studentPages[0].reduce((sum, row) => sum + row.height, 0) + 53);
  let page = pdf.addPage([PAGE_WIDTH, pageHeight]);
  let y = pageHeight - MARGIN;
  page.drawText("成績分析室  /  考試報告", { x: MARGIN, y, font, size: 9, color: GREEN });
  y -= 29;
  drawLines(page, classLines, MARGIN, y, font, 19);
  y -= classLines.length * 23 + 7;
  drawLines(page, examLines, MARGIN, y, font, 12, MUTED);
  y -= examLines.length * 17 + 19;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.5, color: GREEN });
  y -= 21;

  const metrics = [
    ["已輸入", `${report.count} / ${klass.students.length}`],
    ["平均分", report.average === null ? "—" : report.average.toFixed(2)],
    ["最高分", report.max === null ? "—" : String(report.max)],
    ["50 分或以上", report.count ? `${(report.at50 / report.count * 100).toFixed(1)}%` : "—"],
  ];
  metrics.forEach(([label, value], index) => metric(page, font, MARGIN + index * ((CONTENT_WIDTH - 24) / 4 + 8), y, label, value, index === 0));
  y -= 84;
  noteLines.forEach(lines => { drawLines(page, lines, MARGIN, y, font, 9, MUTED); y -= lines.length * 14; });
  y -= 11;
  page.drawText("學生分數", { x: MARGIN, y, font, size: 12, color: DARK });
  y -= 14;
  y = tableHeading(page, font, y);

  const continuationTitle = wrap(`${klass.name}  /  ${exam.name}`, font, 9, CONTENT_WIDTH);
  for (const [pageIndex, group] of studentPages.entries()) {
    if (pageIndex > 0) {
      const continuationOffset = MARGIN + continuationTitle.length * 14 + 8 + 14 + 28;
      const continuationHeight = Math.max(PAGE_HEIGHT, continuationOffset + group.reduce((sum, row) => sum + row.height, 0) + 53);
      page = pdf.addPage([PAGE_WIDTH, continuationHeight]);
      y = continuationHeight - MARGIN;
      drawLines(page, continuationTitle, MARGIN, y, font, 9, GREEN);
      y -= continuationTitle.length * 14 + 8;
      page.drawText("學生分數", { x: MARGIN, y, font, size: 12, color: DARK });
      y -= 14;
      y = tableHeading(page, font, y);
    }
    for (const { row, index, cells, lines, height } of group) {
      if (index % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: rgb(0.985, 0.99, 0.985) });
      let x = MARGIN;
      lines.forEach((parts, cellIndex) => {
        if (cellIndex === 3 && row.kind === "valid" && row.grade) {
          page.drawText(parts[0], { x: x + 7, y: y - 17, font: latinFont, size: 9, color: GREEN });
          if (parts.length > 1 && row.gapPercent !== null) page.drawRectangle({ x: x + 4, y: y - 34, width: Math.min(cells[cellIndex].width - 11, font.widthOfTextAtSize(parts[1], 9) + 10), height: 15, color: YELLOW });
          drawLines(page, parts.slice(1), x + 7, y - 30, font, 9, AMBER, 13);
        } else drawLines(page, parts, x + 7, y - 17, font, 9, DARK, 13);
        x += cells[cellIndex].width;
      });
      page.drawLine({ start: { x: MARGIN, y: y - height }, end: { x: PAGE_WIDTH - MARGIN, y: y - height }, thickness: 0.5, color: LINE });
      y -= height;
    }
  }

  drawGradeStatisticsPage(pdf, font, latinFont, klass, exam, report);

  pdf.getPages().forEach((reportPage, index) => {
    const footer = `${index + 1} / ${pdf.getPageCount()}`;
    reportPage.drawText(footer, { x: reportPage.getWidth() - MARGIN - font.widthOfTextAtSize(footer, 8), y: 26, font, size: 8, color: MUTED });
  });
  return pdf.save();
}
