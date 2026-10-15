import assert from "node:assert/strict";
import test from "node:test";
import { analyze, boundsForNewExam, compareExams, cumulativeGradeCounts, gradeConfig, LEVELS, moveExam, parseNames, parseScore, rankStudentRows, recordsForEmail, summarizeStudentExams, summarizeStudentRecords, validDocument, withoutClass, withoutExam } from "../lib/grade.ts";
import { isAdmin, isStudent } from "../lib/access.ts";

test("score parsing rejects out-of-range and malformed entries", () => {
  assert.deepEqual(parseScore(""), { kind: "blank" });
  assert.deepEqual(parseScore("/"), { kind: "abs" });
  assert.deepEqual(parseScore(" / "), { kind: "abs" });
  assert.deepEqual(parseScore("0"), { kind: "valid", value: 0 });
  assert.deepEqual(parseScore("100"), { kind: "valid", value: 100 });
  assert.deepEqual(parseScore("10.5"), { kind: "valid", value: 10.5 });
  for (const value of ["-1", "101", "10abc", "NaN", "1,000", "//"]) assert.equal(parseScore(value).kind, "invalid");
});

test("absent students display ABS and are excluded from grade statistics", () => {
  const klass = { id: "c", name: "5A", students: ["s1", "s2", "s3"].map(id => ({ id, name: id })) };
  const exam = { id: "e", classId: "c", name: "Term 1", bounds: ["0", "10", "20", "30", "40", "50", "60", "90"], scores: { s1: "80", s2: "/", s3: "" } };
  const report = analyze(klass, exam);
  assert.equal(report.count, 1);
  assert.equal(report.absent, 1);
  assert.equal(report.invalid, 0);
  assert.equal(report.average, 80);
  assert.deepEqual(report.detail[1], { student: klass.students[1], raw: "/", kind: "abs", band: "缺考", grade: "ABS", value: null, nextLevel: "", gapPercent: null });
  assert.equal(report.bands.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(report.grades.reduce((sum, count) => sum + count, 0), 1);
});

test("a score within three points shows the exact gap to the next grade", () => {
  const klass = { id: "c", name: "5A", students: ["a", "b", "c", "d", "e"].map(id => ({ id, name: id })) };
  const exam = { id: "e", classId: "c", name: "Mock", bounds: ["0", "20", "30", "47", "63", "77", "87", "92"], scores: { a: "89.5", b: "84", c: "92", d: "/", e: "83.9" } };
  const rows = analyze(klass, exam).detail;
  assert.deepEqual([rows[0].grade, rows[0].nextLevel, rows[0].gapPercent], ["5*", "5**", 2.5]);
  assert.deepEqual([rows[1].grade, rows[1].nextLevel, rows[1].gapPercent], ["5", "5*", 3]);
  assert.deepEqual([rows[2].grade, rows[2].nextLevel, rows[2].gapPercent], ["5**", "", null]);
  assert.equal(rows[3].gapPercent, null);
  assert.equal(rows[4].gapPercent, null);
});

test("student email links expose only that student's exam records", () => {
  const document = {
    classes: [{ id: "c", name: "5A", students: [{ id: "a", name: "陳同學", email: "student@gmail.com" }, { id: "b", name: "李同學", email: "other@gmail.com" }] }],
    exams: [{ id: "e", classId: "c", name: "Mock", bounds: ["0", "20", "30", "47", "63", "77", "87", "92"], scores: { a: "89.5", b: "30" } }],
  };
  assert.equal(validDocument(document), true);
  assert.equal(recordsForEmail(document, "Student@Gmail.com").records.length, 1);
  assert.equal(recordsForEmail(document, "student@gmail.com").records[0].score, "89.5");
  assert.equal(recordsForEmail(document, "student@gmail.com").records[0].gapPercent, 2.5);
  const ownRecords = recordsForEmail(document, "student@gmail.com").records;
  const ownSummary = summarizeStudentRecords(ownRecords.map((record, index) => ({ id: String(index), name: record.examName, kind: record.kind, score: record.value, grade: record.grade, gradeIndex: LEVELS.indexOf(record.grade) })));
  assert.equal(ownSummary.average, 89.5);
  assert.deepEqual(ownSummary.overall, { lower: "5*", upper: "5*", examCount: 1 });
  assert.equal(ownSummary.records.some(record => record.score === 30), false);
  assert.deepEqual(recordsForEmail(document, "unknown@gmail.com"), { linked: false, records: [] });
  document.classes[0].students[1].email = "STUDENT@gmail.com";
  assert.equal(validDocument(document), false);
});

test("administrator access is tied to the specified authenticated email", () => {
  const admin = { userId: "a", email: "admin@example.com", provider: "google" };
  const student = { userId: "b", email: "student@gmail.com", provider: "google" };
  assert.equal(isAdmin(admin), true);
  assert.equal(isStudent(admin), false);
  assert.equal(isAdmin(student), false);
  assert.equal(isStudent(student), true);
  assert.equal(isStudent({ ...student, provider: "chatgpt" }), false);
});

test("score bands and configurable grade boundaries include exact thresholds", () => {
  const klass = { id: "c", name: "5A", students: [0, 9.9, 10, 19.9, 20, 89.9, 90, 100].map((_, i) => ({ id: `s${i}`, name: `Student ${i}` })) };
  const scores = Object.fromEntries(klass.students.map((student, i) => [student.id, String([0, 9.9, 10, 19.9, 20, 89.9, 90, 100][i])]));
  const exam = { id: "e", classId: "c", name: "Term 1", bounds: ["0", "10", "20", "30", "40", "50", "60", "90"], scores };
  const report = analyze(klass, exam);
  assert.deepEqual(report.bands, [2, 2, 1, 0, 0, 0, 0, 0, 1, 2]);
  assert.deepEqual(report.detail.map(r => r.grade), ["U", "U", "1", "1", "2", "5*", "5**", "5**"]);
  assert.equal(report.count, 8);
  assert.equal(report.detail[7].band, "90–100");
  assert.equal(gradeConfig(["0", "10", "10", "30", "40", "50", "60", "90"]).ready, false);
});

test("cumulative grade shares count each level and above, with U separate", () => {
  const grades = [2, 3, 4, 5, 6, 7, 8, 9];
  assert.deepEqual(cumulativeGradeCounts(grades), [2, 42, 39, 35, 30, 24, 17, 9]);
  assert.equal(cumulativeGradeCounts(grades)[1] / grades.reduce((a, b) => a + b) * 100, 42 / 44 * 100);
});

test("exam comparison uses valid scores for average and 50-point pass rate", () => {
  const klass = { id: "c", name: "5A", students: [{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "c", name: "丙" }] };
  const bounds = ["0", "20", "30", "40", "50", "60", "70", "90"];
  const compared = compareExams(klass, [
    { id: "e1", classId: "c", name: "第一次", bounds, scores: { a: "40", b: "60", c: "/" } },
    { id: "e2", classId: "c", name: "第二次", bounds, scores: { a: "70", b: "90", c: "50" } },
    { id: "e3", classId: "c", name: "第三次", bounds, scores: {} },
  ]);
  assert.deepEqual(compared.map(item => [item.count, item.average, item.passRate]), [[2, 50, 50], [3, 70, 100], [0, null, null]]);
});

test("student history separates score average from a recent weighted grade range", () => {
  const klass = { id: "c", name: "5A", students: [{ id: "s", name: "陳同學" }] };
  const bounds = ["0", "10", "20", "30", "40", "50", "60", "90"];
  const exams = [
    { id: "e1", classId: "c", name: "考試一", bounds, scores: { s: "45" } },
    { id: "e2", classId: "c", name: "考試二", bounds, scores: { s: "55" } },
    { id: "e3", classId: "c", name: "考試三", bounds, scores: { s: "/" } },
    { id: "e4", classId: "c", name: "考試四", bounds: ["0", "", "", "", "", "", "", ""], scores: { s: "70" } },
  ];
  const summary = summarizeStudentExams(klass, exams, "s");
  assert.equal(summary.average, 170 / 3);
  assert.equal(summary.scoreCount, 3);
  assert.equal(summary.gradedCount, 2);
  assert.deepEqual(summary.records.map(record => record.grade), ["4", "5", "ABS", ""]);
  assert.deepEqual(summary.overall, { lower: "4", upper: "5", examCount: 2 });
});

test("reordering exams changes chronology without moving another class's exam", () => {
  const klass = { id: "a", name: "A", students: [{ id: "s", name: "學生" }] };
  const bounds = ["0", "10", "20", "30", "40", "50", "60", "90"];
  const document = { classes: [klass, { id: "b", name: "B", students: [] }], exams: [
    { id: "e1", classId: "a", name: "首次", bounds, scores: { s: "15" } },
    { id: "other", classId: "b", name: "另一班", bounds, scores: {} },
    { id: "e2", classId: "a", name: "第二次", bounds, scores: { s: "75" } },
  ] };
  const moved = moveExam(document, "e2", -1);
  assert.deepEqual(moved.exams.map(exam => exam.id), ["e2", "other", "e1"]);
  assert.deepEqual(document.exams.map(exam => exam.id), ["e1", "other", "e2"]);
  assert.deepEqual(summarizeStudentExams(klass, moved.exams, "s").records.map(record => record.id), ["e2", "e1"]);
  assert.notDeepEqual(summarizeStudentExams(klass, moved.exams, "s").overall, summarizeStudentExams(klass, document.exams, "s").overall);
  assert.strictEqual(moveExam(moved, "e2", -1), moved);
});

test("PDF ranking sorts valid scores and gives ties the same competition rank", () => {
  const students = ["a", "b", "c", "d", "e", "f"].map(id => ({ id, name: id }));
  const klass = { id: "c", name: "5A", students };
  const exam = { id: "e", classId: "c", name: "Mock", bounds: ["0", "10", "20", "30", "40", "50", "60", "90"], scores: { a: "70", b: "80", c: "80", d: "/", e: "0", f: "oops" } };
  const ranked = rankStudentRows(analyze(klass, exam));
  assert.deepEqual(ranked.map(item => [item.row.student.id, item.rank]), [["b", 1], ["c", 1], ["a", 3], ["e", 4], ["d", null], ["f", null]]);
});

test("deleting an exam preserves its class and other exams; deleting a class removes only its own exams", () => {
  const bounds = ["0", "20", "30", "40", "50", "60", "70", "90"];
  const document = { classes: [{ id: "a", name: "A", students: [] }, { id: "b", name: "B", students: [] }], exams: [
    { id: "e1", classId: "a", name: "甲", bounds, scores: {} },
    { id: "e2", classId: "a", name: "乙", bounds, scores: {} },
    { id: "e3", classId: "b", name: "丙", bounds, scores: {} },
  ] };
  assert.deepEqual(withoutExam(document, "e1").exams.map(item => item.id), ["e2", "e3"]);
  assert.deepEqual(withoutClass(document, "a").exams.map(item => item.id), ["e3"]);
  assert.deepEqual(withoutClass(document, "a").classes.map(item => item.id), ["b"]);
  assert.deepEqual(document.exams.map(item => item.id), ["e1", "e2", "e3"]);
});

test("class roster is reusable across exams and isolated from other classes", () => {
  const document = {
    classes: [
      { id: "c1", name: "5A", students: [{ id: "s1", name: "陳同學" }] },
      { id: "c2", name: "5B", students: [{ id: "s2", name: "李同學" }] },
    ],
    exams: [
      { id: "e1", classId: "c1", name: "上學期", bounds: ["0", "10", "20", "30", "40", "50", "60", "90"], scores: { s1: "65" } },
      { id: "e2", classId: "c1", name: "下學期", bounds: ["0", "10", "20", "30", "40", "50", "60", "90"], scores: { s1: "70" } },
    ],
  };
  assert.equal(validDocument(document), true);
  assert.equal(analyze(document.classes[0], document.exams[0]).detail[0].raw, "65");
  assert.equal(analyze(document.classes[0], document.exams[1]).detail[0].raw, "70");
  document.exams[1].scores.s2 = "80";
  assert.equal(validDocument(document), false);
  assert.deepEqual(parseNames("陳同學\n\n李同學"), ["陳同學", "李同學"]);
});

test("a class grading preset fills new exams without tying later exam edits to the preset", () => {
  const gradingDefault = ["0", "10", "20", "35", "50", "65", "80", "92"];
  const klass = { id: "c", name: "5A", students: [], gradingDefault };
  const firstExamBounds = boundsForNewExam(klass);
  assert.deepEqual(firstExamBounds, gradingDefault);
  firstExamBounds[5] = "70";
  assert.equal(klass.gradingDefault[5], "65");
  assert.deepEqual(boundsForNewExam(klass), gradingDefault);
  assert.equal(validDocument({ classes: [klass], exams: [] }), true);
  assert.equal(validDocument({ classes: [{ ...klass, gradingDefault: ["0", "10", "20"] }], exams: [] }), false);
  assert.equal(validDocument({ classes: [{ ...klass, gradingDefault: [] }], exams: [] }), true);
  assert.deepEqual(boundsForNewExam({ ...klass, gradingDefault: [] }), ["0", "", "", "", "", "", "", ""]);
});
