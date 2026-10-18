export const LEVELS = ["U", "1", "2", "3", "4", "5", "5*", "5**"] as const;
export const CUMULATIVE_LEVELS = ["U", "1+", "2+", "3+", "4+", "5+", "5*+", "5**"] as const;
export type Student = { id: string; name: string; email?: string };
export type ClassRoom = { id: string; name: string; students: Student[]; gradingDefault?: string[] };
export type Exam = { id: string; classId: string; name: string; bounds: string[]; scores: Record<string, string> };
export type ScoreOrder = "roster" | "rank";
export type GradeGroup = { id: string; name: string; classIds: string[]; examIds?: Record<string, string> };
export type Document = { classes: ClassRoom[]; exams: Exam[]; scoreOrderDefault?: ScoreOrder; gradeGroups?: GradeGroup[] };
export const EMPTY: Document = { classes: [], exams: [] };
export const ADMIN_EMAIL = "admin@example.com";

export const normalizeEmail = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();
export const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// U is its own share; each + label counts students at that level or higher.
export function cumulativeGradeCounts(grades: number[]): number[] {
  return grades.map((count, index) => index === 0 ? count : grades.slice(index).reduce((sum, value) => sum + value, 0));
}

export function parseScore(raw: string | number | null | undefined): { kind: "blank" | "abs" | "invalid" | "valid"; value?: number } {
  const s = String(raw ?? "").trim();
  if (!s) return { kind: "blank" };
  if (s === "/") return { kind: "abs" };
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return { kind: "invalid" };
  const value = Number(s);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? { kind: "valid", value } : { kind: "invalid" };
}

export function gradeConfig(bounds: string[]) {
  if (bounds.length !== 8) return { ready: false, values: [] as number[], message: "請填妥所有等級最低分" };
  const parsed = bounds.map(parseScore);
  if (parsed.some(v => v.kind !== "valid")) return { ready: false, values: [] as number[], message: "請填妥各級最低分（0–100）" };
  const values = parsed.map(v => v.value!);
  if (values[0] !== 0) return { ready: false, values, message: "U 須由 0 分開始" };
  if (values.some((v, i) => i > 0 && v <= values[i - 1])) return { ready: false, values, message: "分界須由低至高，不可重複" };
  return { ready: true, values, message: "分界已設定" };
}

export function boundsForNewExam(klass: ClassRoom): string[] {
  return klass.gradingDefault?.length === 8 && gradeConfig(klass.gradingDefault).ready
    ? [...klass.gradingDefault]
    : ["0", "", "", "", "", "", "", ""];
}

export function analyze(klass: ClassRoom | undefined, exam: Exam | undefined) {
  const bounds = exam?.bounds ?? ["0", "", "", "", "", "", "", ""];
  const config = gradeConfig(bounds);
  const bands = Array(10).fill(0) as number[];
  const grades = Array(8).fill(0) as number[];
  const detail = (klass?.students ?? []).map(student => {
    const raw = exam?.scores[student.id] ?? "";
    const parsed = parseScore(raw);
    if (parsed.kind !== "valid") return { student, raw, kind: parsed.kind, band: parsed.kind === "abs" ? "缺考" : "", grade: parsed.kind === "abs" ? "ABS" : "", value: null as number | null, nextLevel: "", gapPercent: null as number | null };
    const value = parsed.value!;
    const bin = Math.min(9, Math.floor(value / 10));
    bands[bin]++;
    let grade = "";
    let nextLevel = "", gapPercent: number | null = null;
    if (config.ready) {
      let index = 0;
      config.values.forEach((threshold, i) => { if (value >= threshold) index = i; });
      grades[index]++;
      grade = LEVELS[index];
      if (index < LEVELS.length - 1) {
        const gap = Number((config.values[index + 1] - value).toFixed(2));
        if (gap > 0 && gap <= 3) { nextLevel = LEVELS[index + 1]; gapPercent = gap; }
      }
    }
    return { student, raw, kind: parsed.kind, band: bin === 9 ? "90–100" : `${bin * 10}–<${bin * 10 + 10}`, grade, value, nextLevel, gapPercent };
  });
  const values = detail.flatMap(row => row.value === null ? [] : [row.value]);
  return { config, bands, grades, detail, count: values.length, absent: detail.filter(r => r.kind === "abs").length, invalid: detail.filter(r => r.kind === "invalid").length,
    average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    max: values.length ? Math.max(...values) : null,
    at50: values.filter(v => v >= 50).length };
}

export function rankStudentRows<T extends ReturnType<typeof analyze>["detail"][number]>(report: { detail: T[] }) {
  const sorted = report.detail.map((row, rosterIndex) => ({ row, rosterIndex })).sort((a, b) => {
    if (a.row.value === null) return b.row.value === null ? a.rosterIndex - b.rosterIndex : 1;
    if (b.row.value === null) return -1;
    return b.row.value - a.row.value || a.rosterIndex - b.rosterIndex;
  });
  let previousScore: number | null = null, currentRank = 0;
  return sorted.map(({ row }, index) => {
    if (row.value === null) return { row, rank: null };
    if (row.value !== previousScore) currentRank = index + 1;
    previousScore = row.value;
    return { row, rank: currentRank };
  });
}

export function analyzeGradeLevel(document: Document, selections: { classId: string; examId: string }[]) {
  const rows = selections.flatMap(({ classId, examId }) => {
    const klass = document.classes.find(item => item.id === classId);
    const exam = document.exams.find(item => item.id === examId && item.classId === classId);
    if (!klass || !exam) return [];
    return analyze(klass, exam).detail.map(row => ({ ...row, classId, className: klass.name, examName: exam.name }));
  });
  const valid = rows.filter((row): row is typeof row & { value: number } => row.value !== null);
  const grades = LEVELS.map(level => valid.filter(row => row.grade === level).length);
  return {
    rows,
    ranked: rankStudentRows({ detail: rows }),
    students: rows.length,
    count: valid.length,
    absent: rows.filter(row => row.kind === "abs").length,
    average: valid.length ? valid.reduce((sum, row) => sum + row.value, 0) / valid.length : null,
    max: valid.length ? Math.max(...valid.map(row => row.value)) : null,
    at50: valid.filter(row => row.value >= 50).length,
    grades,
    graded: grades.reduce((sum, count) => sum + count, 0),
  };
}

export function compareExams(klass: ClassRoom | undefined, exams: Exam[]) {
  return exams.map(exam => {
    const report = analyze(klass, exam);
    return { id: exam.id, name: exam.name, count: report.count,
      average: report.average,
      passRate: report.count ? report.at50 / report.count * 100 : null };
  });
}

export type StudentTrendRecord = { id: string; name: string; kind: ReturnType<typeof parseScore>["kind"]; score: number | null; grade: string; gradeIndex: number | null; className?: string };

export function summarizeStudentRecords(records: StudentTrendRecord[]) {
  const scores = records.flatMap(record => record.score === null ? [] : [record.score]);
  const graded = records.filter((record): record is typeof record & { gradeIndex: number } => record.gradeIndex !== null);
  const recent = graded.slice(-5);
  const weightTotal = recent.reduce((sum, _, index) => sum + index + 1, 0);
  const weightedLevel = weightTotal ? Math.round(recent.reduce((sum, record, index) => sum + record.gradeIndex * (index + 1), 0) / weightTotal * 1_000_000) / 1_000_000 : null;
  const overall = weightedLevel === null ? null : {
    lower: LEVELS[Math.floor(weightedLevel)],
    upper: LEVELS[Math.ceil(weightedLevel)],
    examCount: recent.length,
  };
  return { records, average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null, scoreCount: scores.length, gradedCount: graded.length, overall };
}

export function summarizeStudentExams(klass: ClassRoom | undefined, exams: Exam[], studentId: string) {
  const student = klass?.students.find(item => item.id === studentId);
  const records = student && klass ? exams.filter(exam => exam.classId === klass.id).map(exam => {
    const row = analyze({ ...klass, students: [student] }, exam).detail[0];
    const index = LEVELS.findIndex(level => level === row.grade);
    return { id: exam.id, name: exam.name, kind: row.kind, score: row.value, grade: row.grade, gradeIndex: index < 0 ? null : index };
  }) : [];
  return summarizeStudentRecords(records);
}

export function withoutClass(document: Document, classId: string): Document {
  return { ...document, classes: document.classes.filter(item => item.id !== classId), exams: document.exams.filter(item => item.classId !== classId),
    gradeGroups: document.gradeGroups?.map(group => ({ ...group, classIds: group.classIds.filter(id => id !== classId), examIds: Object.fromEntries(Object.entries(group.examIds ?? {}).filter(([id]) => id !== classId)) })).filter(group => group.classIds.length > 0) };
}

export function withoutExam(document: Document, examId: string): Document {
  return { ...document, exams: document.exams.filter(item => item.id !== examId),
    gradeGroups: document.gradeGroups?.map(group => ({ ...group, examIds: Object.fromEntries(Object.entries(group.examIds ?? {}).filter(([, id]) => id !== examId)) })) };
}

export function moveExam(document: Document, examId: string, direction: -1 | 1): Document {
  const index = document.exams.findIndex(exam => exam.id === examId);
  if (index < 0) return document;
  const classId = document.exams[index].classId;
  const classIndices = document.exams.flatMap((exam, position) => exam.classId === classId ? [position] : []);
  const classPosition = classIndices.indexOf(index);
  const otherIndex = classIndices[classPosition + direction];
  if (otherIndex === undefined) return document;
  const exams = [...document.exams];
  [exams[index], exams[otherIndex]] = [exams[otherIndex], exams[index]];
  return { ...document, exams };
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isShort = (x: unknown, max: number): x is string => typeof x === "string" && x.length <= max;
export function validDocument(input: unknown): input is Document {
  if (!isRecord(input) || !Array.isArray(input.classes) || !Array.isArray(input.exams) || input.classes.length > 100 || input.exams.length > 300) return false;
  if (input.scoreOrderDefault !== undefined && input.scoreOrderDefault !== "roster" && input.scoreOrderDefault !== "rank") return false;
  const classIds = new Set<string>(), examIds = new Set<string>(), studentIds = new Set<string>();
  for (const klass of input.classes) {
    if (!isRecord(klass) || !isShort(klass.id, 80) || !klass.id || !isShort(klass.name, 100) || !klass.name.trim() || !Array.isArray(klass.students) || klass.students.length > 5000 || classIds.has(klass.id)) return false;
    if (klass.gradingDefault !== undefined &&
      (!Array.isArray(klass.gradingDefault) ||
       (klass.gradingDefault.length !== 0 &&
        (klass.gradingDefault.length !== 8 || klass.gradingDefault.some((value: unknown) => !isShort(value, 30)) || !gradeConfig(klass.gradingDefault).ready)))) return false;
    classIds.add(klass.id);
    const classEmails = new Set<string>();
    for (const student of klass.students) {
      if (!isRecord(student) || !isShort(student.id, 80) || !student.id || !isShort(student.name, 120) || !student.name.trim() || studentIds.has(student.id)) return false;
      if (student.email !== undefined) {
        if (!isShort(student.email, 254) || (student.email && !validEmail(student.email))) return false;
        const email = normalizeEmail(student.email);
        if (email && classEmails.has(email)) return false;
        if (email) classEmails.add(email);
      }
      studentIds.add(student.id);
    }
  }
  for (const exam of input.exams) {
    if (!isRecord(exam) || !isShort(exam.id, 80) || !exam.id || examIds.has(exam.id) || !isShort(exam.classId, 80) || !classIds.has(exam.classId) || !isShort(exam.name, 100) || !exam.name.trim() || !Array.isArray(exam.bounds) || exam.bounds.length !== 8 || exam.bounds.some((v: unknown) => !isShort(v, 30)) || !isRecord(exam.scores)) return false;
    examIds.add(exam.id);
    const allowed = new Set((input.classes as ClassRoom[]).find(k => k.id === exam.classId)!.students.map(s => s.id));
    const entries = Object.entries(exam.scores);
    if (entries.length > allowed.size || entries.some(([key, value]) => !allowed.has(key) || !isShort(value, 30))) return false;
  }
  if (input.gradeGroups !== undefined) {
    if (!Array.isArray(input.gradeGroups) || input.gradeGroups.length > 30) return false;
    const groupIds = new Set<string>();
    for (const group of input.gradeGroups) {
      if (!isRecord(group) || !isShort(group.id, 80) || !group.id || groupIds.has(group.id) || !isShort(group.name, 100) || !group.name.trim() || !Array.isArray(group.classIds) || group.classIds.length === 0 || group.classIds.length > 100 || group.classIds.some((id: unknown) => typeof id !== "string" || !classIds.has(id)) || new Set(group.classIds).size !== group.classIds.length) return false;
      groupIds.add(group.id);
      if (group.examIds !== undefined) {
        if (!isRecord(group.examIds)) return false;
        const selectedClassIds = group.classIds as string[];
        const exams = input.exams as Exam[];
        if (Object.entries(group.examIds).some(([classId, examId]) => !selectedClassIds.includes(classId) || !exams.some(exam => exam.id === examId && exam.classId === classId))) return false;
      }
    }
  }
  return true;
}

export function recordsForEmail(document: Document, email: string) {
  const target = normalizeEmail(email);
  const matches = document.classes.flatMap(klass => klass.students.filter(student => !!target && normalizeEmail(student.email) === target).map(student => ({ klass, student })));
  const records = document.exams.flatMap((exam, order) => matches.filter(({ klass }) => klass.id === exam.classId).map(({ klass, student }) => {
    const row = analyze({ ...klass, students: [student] }, exam).detail[0];
    return { className: klass.name, examName: exam.name, studentName: student.name, order, score: row.raw, kind: row.kind, band: row.band, grade: row.grade, nextLevel: row.nextLevel, gapPercent: row.gapPercent, value: row.value };
  }));
  return { linked: matches.length > 0, studentName: matches[0]?.student.name ?? "", records };
}

export function parseNames(text: string) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.slice(0, 120));
}

export type EmailPasteUpdate = { studentId: string; name: string; email: string; previousEmail: string };

export function previewEmailPaste(students: Student[], text: string): {
  mode: "named" | "ordered" | null;
  updates: EmailPasteUpdate[];
  errors: string[];
} {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return { mode: null, updates: [], errors: [] };

  const named = lines.some(line => line.includes("\t"));
  const mode = named ? "named" : "ordered";
  const errors: string[] = [];
  const updates: EmailPasteUpdate[] = [];
  const hasHeader = named
    ? /^(?:學生)?姓名\s*\t\s*(?:google\s*(?:account|電郵|帳戶)|電郵|email|e-mail)/i.test(lines[0])
    : /^(?:google\s*(?:account|電郵|帳戶)|電郵|email|e-mail)$/i.test(lines[0].trim());
  const candidates = hasHeader ? lines.slice(1) : lines;

  if (!named && candidates.length !== students.length) {
    return { mode, updates, errors: [`只貼電郵時，必須按名單順序貼上 ${students.length} 行；目前有 ${candidates.length} 行。若只更新部分學生，請貼上「姓名、電郵」兩欄。`] };
  }

  const seenNames = new Set<string>();
  candidates.forEach((line, index) => {
    if (!line.trim()) return;
    let student: Student | undefined;
    let rawEmail: string;
    if (named) {
      const cells = line.split("\t");
      if (cells.length !== 2) { errors.push(`第 ${index + 1 + Number(hasHeader)} 行須為「姓名」和「Google 電郵」兩欄。`); return; }
      const name = cells[0].trim();
      if (!name) { errors.push(`第 ${index + 1 + Number(hasHeader)} 行缺少學生姓名。`); return; }
      if (seenNames.has(name)) { errors.push(`「${name}」在貼上內容中重複。`); return; }
      seenNames.add(name);
      const matches = students.filter(item => item.name.trim() === name);
      if (matches.length !== 1) { errors.push(matches.length ? `名單中有多位「${name}」，無法安全配對。` : `名單中找不到「${name}」。`); return; }
      student = matches[0];
      rawEmail = cells[1];
    } else {
      student = students[index];
      rawEmail = line;
    }
    const email = normalizeEmail(rawEmail);
    if (!email) return; // A blank cell leaves the existing address unchanged.
    if (!validEmail(email)) { errors.push(`「${student.name}」的電郵格式不正確。`); return; }
    const previousEmail = normalizeEmail(student.email);
    if (email !== previousEmail) updates.push({ studentId: student.id, name: student.name, email, previousEmail });
  });

  const nextEmails = new Map(students.map(student => [student.id, normalizeEmail(student.email)]));
  for (const update of updates) nextEmails.set(update.studentId, update.email);
  const owners = new Map<string, string>();
  for (const student of students) {
    const email = nextEmails.get(student.id);
    if (!email) continue;
    const owner = owners.get(email);
    if (owner) errors.push(`同一 Google 電郵不能同時配對「${owner}」和「${student.name}」。`);
    else owners.set(email, student.name);
  }
  return { mode, updates, errors };
}
