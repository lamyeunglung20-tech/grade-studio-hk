import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { summarizeStudentRecords } from "../lib/grade.ts";
import { createStudentTrendPdf } from "../lib/pdf-student.ts";

test("student trend PDF includes the same aggregate grade and paginates exam records", async () => {
  const records = Array.from({ length: 11 }, (_, index) => ({
    id: `exam-${index}`,
    name: `化學考試 ${index + 1}`,
    className: "中五級化學中文組",
    kind: index === 5 ? "abs" : "valid",
    score: index === 5 ? null : 50 + index * 3,
    grade: index === 5 ? "ABS" : index < 4 ? "3" : "4",
    gradeIndex: index === 5 ? null : index < 4 ? 3 : 4,
  }));
  const summary = summarizeStudentRecords(records);
  assert.equal(summary.scoreCount, 10);
  assert.equal(summary.gradedCount, 10);
  assert.deepEqual(summary.overall, { lower: "4", upper: "4", examCount: 5 });
  const font = await readFile(new URL("../public/fonts/NotoSansHK-Regular.otf", import.meta.url));
  const bytes = await createStudentTrendPdf("陳同學", "中五級化學中文組", summary, font);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getTitle(), "陳同學 - 學生趨勢報告");
});
