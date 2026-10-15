import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { analyze } from "../lib/grade.ts";
import { createGradeReportPdf } from "../lib/pdf-report.ts";

test("downloadable report limits student pages to 20 rows and puts statistics last", async () => {
  const students = Array.from({ length: 72 }, (_, index) => ({ id: `s${index}`, name: index === 0 ? "陳小明" : `學生 ${index + 1}` }));
  const klass = { id: "c", name: "中五級化學中文組", students };
  const scores = Object.fromEntries(students.map((student, index) => [student.id, index === 1 ? "/" : String(index % 101)]));
  const exam = { id: "e", classId: klass.id, name: "期中考試", bounds: ["0", "10", "20", "30", "40", "50", "60", "90"], scores };
  const report = analyze(klass, exam);
  const font = await readFile(new URL("../public/fonts/NotoSansHK-Regular.otf", import.meta.url));
  const bytes = await createGradeReportPdf(klass, exam, report, font);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length > 10_000);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 5);
  assert.ok(pdf.getPage(0).getHeight() >= pdf.getPage(4).getHeight());
  assert.equal(pdf.getTitle(), "中五級化學中文組 - 期中考試 - 成績報告");
  assert.equal(report.absent, 1);
  assert.equal(report.count, 71);
});

test("the 41st student starts a third student page", async () => {
  const students = Array.from({ length: 41 }, (_, index) => ({ id: `s${index}`, name: `學生 ${index + 1}` }));
  const klass = { id: "c", name: "大型班別", students };
  const exam = { id: "e", classId: klass.id, name: "考試", bounds: ["0", "10", "20", "30", "40", "50", "60", "90"], scores: Object.fromEntries(students.map(student => [student.id, "75"])) };
  const font = await readFile(new URL("../public/fonts/NotoSansHK-Regular.otf", import.meta.url));
  const pdf = await PDFDocument.load(await createGradeReportPdf(klass, exam, analyze(klass, exam), font));
  assert.equal(pdf.getPageCount(), 4);
  assert.equal(pdf.getPage(0).getWidth(), pdf.getPage(3).getWidth());
});
