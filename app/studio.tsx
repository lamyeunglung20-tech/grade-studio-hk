"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze, boundsForNewExam, compareExams, CUMULATIVE_LEVELS, cumulativeGradeCounts, EMPTY, LEVELS, moveExam, normalizeEmail, parseNames, rankStudentRows, summarizeStudentExams, validDocument, validEmail, withoutClass, withoutExam, type ClassRoom, type Document, type Exam } from "../lib/grade";
import { downloadStudentTrendPdf } from "../lib/pdf-student-download";
import { RevisionConflictError, type GradeBackend } from "../lib/grade-backend";

const uid = () => crypto.randomUUID();
const makeExam = (klass: ClassRoom, name = "新考試"): Exam => ({ id: uid(), classId: klass.id, name, bounds: boundsForNewExam(klass), scores: {} });
const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[\t\r\n ]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
};
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function legacyData(): Document | null {
  try {
    const raw = localStorage.getItem("grade-studio-v1"); if (!raw) return null;
    const old = JSON.parse(raw);
    if (!Array.isArray(old.exams) || !old.exams.length) return null;
    const classes: ClassRoom[] = [], exams: Exam[] = [];
    for (const item of old.exams.slice(0, 100)) {
      const classId = uid();
      const rows = Array.isArray(item.rows) ? item.rows.slice(0, 5000) : [];
      const students = rows.map((row: { name?: unknown }, i: number) => ({ id: uid(), name: typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 120) : `學生 ${i + 1}` }));
      classes.push({ id: classId, name: `${String(item.name || "舊考試").slice(0, 89)} 名單`, students });
      const bounds = Array.isArray(item.bounds) && item.bounds.length === 8 ? item.bounds.map((x: unknown) => String(x ?? "")) : ["0", "", "", "", "", "", "", ""];
      const scores: Record<string, string> = {};
      rows.forEach((row: { raw?: unknown }, i: number) => { scores[students[i].id] = String(row.raw ?? "").slice(0, 30); });
      exams.push({ id: uid(), classId, name: String(item.name || "舊考試").trim().slice(0, 100), bounds, scores });
    }
    const migrated = { classes, exams };
    return validDocument(migrated) ? migrated : null;
  } catch { return null; }
}

function ExamTrendChart({ items, metric }: { items: ReturnType<typeof compareExams>; metric: "average" | "passRate" }) {
  const width = Math.max(650, items.length * 145 + 40);
  const top = 32, bottom = 222, axisX = 46, firstPointX = 110, right = 100;
  const xAt = (index: number) => firstPointX + index * (width - firstPointX - right) / (items.length - 1);
  const yAt = (value: number) => bottom - value / 100 * (bottom - top);
  const points = items.map((item, index) => ({ ...item, value: item[metric], x: xAt(index) }));
  let path = "", previousHasValue = false;
  for (const point of points) {
    if (point.value === null) { previousHasValue = false; continue; }
    path += `${previousHasValue ? " L" : " M"}${point.x.toFixed(1)} ${yAt(point.value).toFixed(1)}`;
    previousHasValue = true;
  }
  const unit = metric === "average" ? "分" : "%";
  const title = metric === "average" ? "平均分趨勢" : "合格率趨勢";
  return <div className="comparison-trend">
    <svg width={width} height="292" viewBox={`0 0 ${width} 292`} role="img" aria-label={`${title}：${points.map(point => `${point.name} ${point.value === null ? "沒有有效分數" : `${point.value.toFixed(metric === "average" ? 2 : 1)}${unit}`}`).join("；")}`}>
      {[0, 25, 50, 75, 100].map(value => <g key={value}><line x1={axisX} x2={width - right} y1={yAt(value)} y2={yAt(value)} stroke="#dce6dc" strokeDasharray={value === 0 ? undefined : "4 5"}/><text x={axisX - 10} y={yAt(value) + 4} textAnchor="end" fill="#708477" fontSize="11">{value}</text></g>)}
      <path d={path} fill="none" stroke="#286047" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
      {points.map(point => {
        const label = point.value === null ? "" : `${point.value.toFixed(metric === "average" ? 2 : 1)}${unit}`;
        const labelY = point.value === null ? 0 : yAt(point.value) < 55 ? yAt(point.value) + 22 : yAt(point.value) - 13;
        return <g key={point.id}>
        <line x1={point.x} x2={point.x} y1={bottom} y2={bottom + 5} stroke="#b4c3b6"/>
        {point.value !== null && <><circle cx={point.x} cy={yAt(point.value)} r="6" fill="#fff" stroke="#286047" strokeWidth="3"/><rect x={point.x - label.length * 3.7 - 6} y={labelY - 13} width={label.length * 7.4 + 12} height="18" rx="4" fill="#fff"/><text x={point.x} y={labelY} textAnchor="middle" fill="#286047" fontSize="12" fontWeight="700">{label}</text></>}
        <text x={point.x} y="253" textAnchor="middle" fill="#26372c" fontSize="11"><title>{point.name}</title>{point.name.length > 16 ? `${point.name.slice(0, 15)}…` : point.name}</text>
        <text x={point.x} y="273" textAnchor="middle" fill="#708477" fontSize="10">{point.count} 位</text>
      </g>; })}
    </svg>
  </div>;
}

const showLevel = (level: string) => level === "U" ? "U" : `Lv${level}`;

function StudentHistoryChart({ summary, metric }: { summary: ReturnType<typeof summarizeStudentExams>; metric: "score" | "grade" }) {
  const available = summary.records.some(record => metric === "score" ? record.score !== null : record.gradeIndex !== null);
  if (!available) return <p className="help">{metric === "score" ? "這位學生暫時沒有有效分數。" : "這位學生暫時沒有可用的預測等級；請先輸入分數及設定考試 grading。"}</p>;
  const width = Math.max(650, summary.records.length * 145 + 40);
  const top = 33, bottom = 239, axisX = 47, firstPointX = 110, right = 100;
  const maxValue = metric === "score" ? 100 : LEVELS.length - 1;
  const yAt = (value: number) => bottom - value / maxValue * (bottom - top);
  const xAt = (index: number) => summary.records.length === 1 ? width / 2 : firstPointX + index * (width - firstPointX - right) / (summary.records.length - 1);
  const points = summary.records.map((record, index) => ({ record, x: xAt(index), value: metric === "score" ? record.score : record.gradeIndex }));
  let path = "", previousHasValue = false;
  for (const point of points) {
    if (point.value === null) { previousHasValue = false; continue; }
    path += `${previousHasValue ? " L" : " M"}${point.x.toFixed(1)} ${yAt(point.value).toFixed(1)}`;
    previousHasValue = true;
  }
  const ticks = metric === "score" ? [0, 25, 50, 75, 100] : LEVELS.map((_, index) => index);
  return <div className="student-history-chart"><svg width={width} height="315" viewBox={`0 0 ${width} 315`} role="img" aria-label={`${metric === "score" ? "分數" : "預測等級"}趨勢：${points.map(point => `${point.record.name} ${point.value === null ? "沒有資料" : metric === "score" ? `${point.value} 分` : showLevel(point.record.grade)}`).join("；")}`}>
    {ticks.map(value => <g key={value}><line x1={axisX} x2={width - right} y1={yAt(value)} y2={yAt(value)} stroke="#dce6dc" strokeDasharray={value === 0 ? undefined : "4 5"}/><text x={axisX - 10} y={yAt(value) + 4} textAnchor="end" fill="#708477" fontSize="11">{metric === "score" ? value : showLevel(LEVELS[value])}</text></g>)}
    <path d={path} fill="none" stroke="#286047" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
    {points.map(point => {
      const label = point.value === null ? "" : metric === "score" ? String(point.value) : showLevel(point.record.grade);
      const labelY = point.value === null ? 0 : yAt(point.value) < 56 ? yAt(point.value) + 23 : yAt(point.value) - 13;
      return <g key={point.record.id}>
        <line x1={point.x} x2={point.x} y1={bottom} y2={bottom + 5} stroke="#b4c3b6"/>
        {point.value !== null && <><circle cx={point.x} cy={yAt(point.value)} r="6" fill="#fff" stroke="#286047" strokeWidth="3"/><rect x={point.x - label.length * 4 - 6} y={labelY - 13} width={label.length * 8 + 12} height="18" rx="4" fill="#fff"/><text x={point.x} y={labelY} textAnchor="middle" fill="#286047" fontSize="12" fontWeight="700">{label}</text></>}
        <text x={point.x} y="270" textAnchor="middle" fill="#26372c" fontSize="11"><title>{point.record.name}</title>{point.record.name.length > 16 ? `${point.record.name.slice(0, 15)}…` : point.record.name}</text>
        <text x={point.x} y="291" textAnchor="middle" fill="#708477" fontSize="10">{point.record.kind === "abs" ? "ABS" : point.record.kind === "blank" ? "未填" : point.record.kind === "invalid" ? "分數無效" : ""}</text>
      </g>;
    })}
  </svg></div>;
}

type Props = { displayName: string; userId: string; signOutPath: string; googleToken?: () => Promise<string>; onGoogleSignIn?: () => Promise<void>; onGoogleSignOut?: () => Promise<void>; backend?: GradeBackend };
type SaveState = "loading" | "saved" | "saving" | "error" | "conflict";

export default function Studio({ displayName, userId, signOutPath, googleToken, onGoogleSignIn, onGoogleSignOut, backend }: Props) {
  const [doc, setDoc] = useState<Document>(EMPTY);
  const [classId, setClassId] = useState("");
  const [examId, setExamId] = useState("");
  const [status, setStatus] = useState<SaveState>("loading");
  const [message, setMessage] = useState("");
  const [newClass, setNewClass] = useState(false);
  const [className, setClassName] = useState("");
  const [classNameDraft, setClassNameDraft] = useState<{ id: string; value: string } | null>(null);
  const [examNameDraft, setExamNameDraft] = useState<{ id: string; value: string } | null>(null);
  const [studentNames, setStudentNames] = useState("");
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [manualSaving, setManualSaving] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [studentPdfExporting, setStudentPdfExporting] = useState(false);
  const [scorePaste, setScorePaste] = useState("");
  const [scoreOrder, setScoreOrder] = useState<"roster" | "rank">("roster");
  const [rankOrderWhileEditing, setRankOrderWhileEditing] = useState<string[] | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [studentAnalysisOpen, setStudentAnalysisOpen] = useState(false);
  const [studentAnalysisId, setStudentAnalysisId] = useState("");
  const [studentAnalysisQuery, setStudentAnalysisQuery] = useState("");
  const [studentAnalysisView, setStudentAnalysisView] = useState<"score" | "grade">("score");
  const [gradesOpen, setGradesOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [view, setView] = useState<"bands" | "grades">("bands");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [examOrderOpen, setExamOrderOpen] = useState(false);
  const [comparisonMetric, setComparisonMetric] = useState<"average" | "passRate">("average");
  const [comparisonExamIds, setComparisonExamIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [legacy, setLegacy] = useState<Document | null>(null);
  const currentRef = useRef<Document>(EMPTY), revisionRef = useRef(0), timerRef = useRef<ReturnType<typeof setTimeout> | null>(null), savingRef = useRef<Promise<boolean> | null>(null), blockedRef = useRef(false), dirtyRef = useRef(false), pendingLegacyRef = useRef<string[] | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    while (!blockedRef.current) {
      if (savingRef.current) {
        const activeSave = savingRef.current;
        const saved = await activeSave;
        if (savingRef.current === activeSave) savingRef.current = null;
        if (!saved) return false;
        if (!dirtyRef.current) return true;
        continue;
      }
      if (!dirtyRef.current) return true;
      const snapshot = currentRef.current;
      const save = (async (): Promise<boolean> => {
        setStatus("saving");
        try {
          let nextRevision: number;
          if (backend) {
            nextRevision = (await backend.saveDocument(revisionRef.current, snapshot)).revision;
          } else {
            const body = JSON.stringify({ revision: revisionRef.current, document: snapshot });
            const token = googleToken ? await googleToken() : null;
            const response = await fetch("/api/document", { method: "PUT", credentials: "same-origin", keepalive: new Blob([body]).size < 60_000, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body });
            const result = await response.json() as { revision?: number; error?: string };
            if (response.status === 409) throw new RevisionConflictError();
            if (!response.ok) throw new Error(result.error || "儲存失敗");
            nextRevision = result.revision!;
          }
          revisionRef.current = nextRevision;
          if (pendingLegacyRef.current?.every(id => snapshot.classes.some(c => c.id === id))) {
            try { localStorage.setItem(`grade-cloud-imported-${userId}`, "yes"); } catch { /* Cloud save still succeeded. */ }
            pendingLegacyRef.current = null;
          }
          if (currentRef.current === snapshot) { dirtyRef.current = false; setStatus("saved"); setMessage(""); }
          return true;
        } catch (error) {
          if (error instanceof RevisionConflictError) { blockedRef.current = true; setStatus("conflict"); setMessage("這份資料已在另一分頁更新。請先下載目前內容，再重新載入最新版本。"); return false; }
          setStatus("error"); setMessage(error instanceof Error ? error.message : "無法連接雲端，請重試"); return false;
        }
      })();
      savingRef.current = save;
      const saved = await save;
      if (savingRef.current === save) savingRef.current = null;
      if (!saved) return false;
    }
    return false;
  }, [userId, googleToken, backend]);
  const change = useCallback((fn: (next: Document) => void): boolean => {
    if (blockedRef.current) { setStatus("conflict"); return false; }
    const next = structuredClone(currentRef.current);
    fn(next);
    if (!validDocument(next)) { setMessage("資料未能更新，請檢查名稱、分數或數量限制。"); setStatus("error"); return false; }
    currentRef.current = next; dirtyRef.current = true; setDoc(next); setStatus("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 650);
    return true;
  }, [flush]);

  useEffect(() => {
    let cancelled = false;
    const request = backend ? backend.loadDocument() : (googleToken ? googleToken() : Promise.resolve(null)).then(token => fetch("/api/document", { cache: "no-store", credentials: "same-origin", headers: token ? { Authorization: `Bearer ${token}` } : {} })).then(async r => {
      if (!r.ok) throw new Error(r.status === 401 ? "登入已逾時，請重新登入。" : "未能讀取雲端資料");
      return await r.json() as { revision: number; document: unknown; legacyDocument?: unknown };
    });
    request.then(result => {
      if (cancelled) return;
      if (!validDocument(result.document)) throw new Error("雲端資料格式不正確");
      const loaded = result.document;
      revisionRef.current = result.revision; currentRef.current = loaded; setDoc(loaded);
      setClassId(loaded.classes[0]?.id || ""); setExamId(loaded.exams.find(e => e.classId === loaded.classes[0]?.id)?.id || "");
      setStatus("saved");
      if (result.legacyDocument && validDocument(result.legacyDocument)) setLegacy(result.legacyDocument);
      else if (!localStorage.getItem(`grade-cloud-imported-${userId}`)) setLegacy(legacyData());
    }).catch(error => { if (!cancelled) { setStatus("error"); setMessage(error.message); } });
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [userId, googleToken, backend]);

  useEffect(() => {
    const saveWhenHidden = () => { if (document.visibilityState === "hidden" && dirtyRef.current) void flush(); };
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => document.removeEventListener("visibilitychange", saveWhenHidden);
  }, [flush]);

  const klass = doc.classes.find(c => c.id === classId), exams = doc.exams.filter(e => e.classId === classId), exam = exams.find(e => e.id === examId);
  const gradingDefault = klass?.gradingDefault;
  const hasGradingDefault = gradingDefault?.length === 8;
  const examUsesDefault = !!exam && hasGradingDefault && exam.bounds.every((value, index) => value === gradingDefault[index]);
  const report = useMemo(() => analyze(doc.classes.find(c => c.id === classId), doc.exams.find(e => e.id === examId)), [doc, classId, examId]);
  const rankedRows = useMemo(() => rankStudentRows(report), [report]);
  const rankByStudentId = useMemo(() => new Map(rankedRows.map(({ row, rank }) => [row.student.id, rank])), [rankedRows]);
  const rankedIds = rankOrderWhileEditing ?? rankedRows.map(({ row }) => row.student.id);
  const rowByStudentId = new Map(report.detail.map(row => [row.student.id, row]));
  const orderedRows = scoreOrder === "rank" ? rankedIds.flatMap(id => rowByStudentId.get(id) ?? []) : report.detail;
  const rows = orderedRows.filter(r => !search.trim() || r.student.name.toLowerCase().includes(search.trim().toLowerCase()) || r.grade.toLowerCase().includes(search.trim().toLowerCase()));
  const counts = view === "bands" ? report.bands : report.grades;
  const cumulativeGrades = cumulativeGradeCounts(report.grades);
  const comparison = useMemo(() => compareExams(doc.classes.find(item => item.id === classId), doc.exams.filter(item => item.classId === classId && comparisonExamIds.includes(item.id))), [doc, classId, comparisonExamIds]);
  const selectedStudent = klass?.students.find(student => student.id === studentAnalysisId);
  const studentOptions = klass?.students.filter(student => student.name.toLowerCase().includes(studentAnalysisQuery.trim().toLowerCase())).slice(0, 200) ?? [];
  if (selectedStudent && !studentOptions.some(student => student.id === selectedStudent.id)) studentOptions.unshift(selectedStudent);
  const studentAnalysis = useMemo(() => summarizeStudentExams(doc.classes.find(item => item.id === classId), doc.exams, studentAnalysisId), [doc, classId, studentAnalysisId]);
  const chartMax = Math.max(1, ...counts);
  const statusText = { loading: "讀取中", saved: "已自動儲存", saving: "儲存中…", error: "尚未儲存", conflict: "需要處理同步衝突" }[status];

  function addClass() {
    const name = className.trim(); if (!name) { setMessage("請輸入班別名稱。"); return; }
    if (doc.classes.length >= 100) { setMessage("最多可建立 100 個班別。"); return; }
    const id = uid(); change(d => { d.classes.push({ id, name, students: [] }); });
    setClassId(id); setExamId(""); setClassName(""); setNewClass(false); setRosterOpen(true); setMessage("");
  }
  function addExam() {
    if (!klass) return;
    if (doc.exams.length >= 300) { setMessage("最多可建立 300 次考試。"); return; }
    const value = makeExam(klass, `考試 ${exams.length + 1}`);
    change(d => { d.exams.push(value); }); setExamId(value.id); setGradesOpen(true); setSearch("");
  }
  async function saveGradingDefault() {
    if (!klass || !exam || !report.config.ready) return;
    if (!change(d => { d.classes.find(item => item.id === klass.id)!.gradingDefault = [...exam.bounds]; })) return;
    if (await flush()) setMessage("已儲存這個班別的 Grading 預設；新考試會自動帶入。");
  }
  function applyGradingDefault() {
    if (!klass || !exam || !hasGradingDefault) return;
    if (change(d => { d.exams.find(item => item.id === exam.id)!.bounds = [...gradingDefault!]; }))
      setMessage("已將班別預設套用到這次考試，正在儲存至雲端。");
  }
  function clearGradingDefault() {
    if (!klass || !hasGradingDefault) return;
    if (change(d => { d.classes.find(item => item.id === klass.id)!.gradingDefault = []; }))
      setMessage("班別預設已清除；現有考試的分界不變。");
  }
  function reorderExam(examToMove: string, direction: -1 | 1) {
    if (change(d => { d.exams = moveExam(d, examToMove, direction).exams; }))
      setMessage("考試次序已更新，正在儲存至雲端。");
  }
  function deleteClass() {
    if (!klass) return;
    const related = doc.exams.filter(item => item.classId === klass.id);
    if (!confirm(`確定刪除班別「${klass.name}」？這會一併移除 ${klass.students.length} 位學生的名單、${related.length} 次考試和全部相關分數。`)) return;
    const nextClassId = doc.classes.find(item => item.id !== klass.id)?.id ?? "";
    if (!change(d => { Object.assign(d, withoutClass(d, klass.id)); })) return;
    setClassId(nextClassId);
    setExamId(doc.exams.find(item => item.classId === nextClassId)?.id ?? "");
    setComparisonOpen(false); setComparisonExamIds([]); setSearch("");
    setStudentAnalysisOpen(false); setStudentAnalysisId(""); setStudentAnalysisQuery("");
    setMessage("班別及相關考試已刪除，正在儲存至雲端。");
  }
  function deleteExam() {
    if (!exam) return;
    if (!confirm(`確定刪除考試「${exam.name}」及這次考試的所有學生分數？`)) return;
    const nextExamId = exams.find(item => item.id !== exam.id)?.id ?? "";
    if (!change(d => { Object.assign(d, withoutExam(d, exam.id)); })) return;
    setExamId(nextExamId);
    setComparisonExamIds(previous => previous.filter(id => id !== exam.id));
    setMessage("考試紀錄已刪除，正在儲存至雲端。");
  }
  function importStudents(): boolean {
    if (!klass) return false;
    const names = parseNames(studentNames);
    if (!names.length) { setMessage("請先貼上姓名，每行一位。"); return false; }
    const existing = new Set(klass.students.map(s => s.name));
    const unique = names.filter(name => { if (existing.has(name)) return false; existing.add(name); return true; });
    if (klass.students.length + unique.length > 5000) { setMessage("每班最多 5,000 位學生。"); return false; }
    if (!unique.length) { setMessage("所有姓名都已在這班名單中。"); return false; }
    if (!change(d => { d.classes.find(c => c.id === klass.id)!.students.push(...unique.map(name => ({ id: uid(), name }))); })) return false;
    setStudentNames(""); setMessage(`已加入 ${unique.length} 位學生${unique.length < names.length ? "，重複姓名已略過" : ""}。`);
    return true;
  }
  async function saveRoster() {
    if (!klass || manualSaving) return;
    if (studentNames.trim() && !importStudents()) return;
    setManualSaving(true);
    try {
      if (await flush()) setMessage("班別及學生名單已儲存到雲端。");
    } finally { setManualSaving(false); }
  }
  function commitClassName(id: string, value: string) {
    setClassNameDraft(null);
    const name = value.trim();
    if (!name) { setMessage("班別名稱不可留空，已保留原有名稱。"); return; }
    if (currentRef.current.classes.find(c => c.id === id)?.name !== name) change(d => { d.classes.find(c => c.id === id)!.name = name; });
  }
  function commitStudentEmail(studentId: string, value: string) {
    setEmailDrafts(previous => { const next = { ...previous }; delete next[studentId]; return next; });
    if (!klass) return;
    const email = normalizeEmail(value);
    if (email && !validEmail(email)) { setMessage("學生電郵格式不正確，原有資料已保留。"); return; }
    if (email && klass.students.some(student => student.id !== studentId && normalizeEmail(student.email) === email)) { setMessage("這個電郵已在本班連結另一位學生。"); return; }
    if ((klass.students.find(student => student.id === studentId)?.email ?? "") !== email) change(d => { d.classes.find(c => c.id === klass.id)!.students.find(student => student.id === studentId)!.email = email; });
  }
  function commitExamName(id: string, value: string) {
    setExamNameDraft(null);
    const name = value.trim();
    if (!name) { setMessage("考試名稱不可留空，已保留原有名稱。"); return; }
    if (currentRef.current.exams.find(e => e.id === id)?.name !== name) change(d => { d.exams.find(e => e.id === id)!.name = name; });
  }
  function pasteScores() {
    if (!klass || !exam) return;
    const lines = scorePaste.replaceAll("，", ",").split(/\r?\n/).flatMap(line => line.includes(",") ? line.split(",") : [line]).map(s => s.trim());
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    if (!lines.length) { setMessage("請先貼上分數。"); return; }
    if (lines.length > klass.students.length) { setMessage("分數多於名單人數，請檢查貼上的資料。"); return; }
    change(d => { const target = d.exams.find(e => e.id === exam.id)!; lines.forEach((value, i) => { target.scores[klass.students[i].id] = value.slice(0, 30); }); });
    setScorePaste(""); setPasteOpen(false); setMessage(`已按名單順序填入 ${lines.length} 個分數。`);
  }
  function exportCsv() {
    if (!klass || !exam) return;
    const table: (string | number)[][] = [["班別", klass.name], ["考試", exam.name], [], ["學生", "分數", "分數區間", "預測等級", "狀態"]];
    report.detail.forEach(r => table.push([r.student.name, r.raw, r.band, r.grade ? `${r.grade}${r.gapPercent === null ? "" : `（距 ${r.nextLevel} 尚差 ${r.gapPercent}%）`}` : "", r.kind === "invalid" ? "分數無效" : r.kind === "abs" ? "缺考" : r.kind === "blank" ? "未填" : report.config.ready ? "有效" : "待設定 grading"]));
    table.push([], ["分數區間", "人數", "比例"]);
    report.bands.forEach((n, i) => table.push([i === 9 ? "90–100" : `${i * 10}–<${i * 10 + 10}`, n, report.count ? `${(n / report.count * 100).toFixed(1)}%` : ""]));
    if (report.config.ready) { table.push([], ["預測等級", "人數", "比例"]); report.grades.forEach((n, i) => table.push([LEVELS[i], n, report.count ? `${(n / report.count * 100).toFixed(1)}%` : ""])); }
    download("\uFEFF" + table.map(row => row.map(csvCell).join(",")).join("\r\n"), `${klass.name}_${exam.name}_成績.csv`.replace(/[\\/:*?"<>|]/g, "_"), "text/csv;charset=utf-8");
  }
  async function exportPdf() {
    if (!klass || !exam || pdfExporting) return;
    setPdfExporting(true);
    try {
      const [{ createGradeReportPdf }, fontResponse] = await Promise.all([
        import("../lib/pdf-report"),
        fetch("/fonts/NotoSansHK-Regular.otf", { cache: "force-cache" }),
      ]);
      if (!fontResponse.ok) throw new Error("未能載入中文字體");
      const bytes = await createGradeReportPdf(klass, exam, report, new Uint8Array(await fontResponse.arrayBuffer()));
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${klass.name}_${exam.name}_成績報告_排名.pdf`.replace(/[\\/:*?"<>|]/g, "_");
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("PDF 已下載。");
    } catch (error) {
      setMessage(error instanceof Error ? `PDF 下載失敗：${error.message}` : "PDF 下載失敗，請重試。");
    } finally { setPdfExporting(false); }
  }
  async function exportStudentPdf() {
    if (!klass || !selectedStudent || studentPdfExporting) return;
    setStudentPdfExporting(true);
    try {
      await downloadStudentTrendPdf(selectedStudent.name, klass.name, {
        ...studentAnalysis,
        records: studentAnalysis.records.map(record => ({ ...record, className: klass.name })),
      });
      setMessage("學生趨勢 PDF 已下載。");
    } catch (error) {
      setMessage(error instanceof Error ? `學生趨勢 PDF 下載失敗：${error.message}` : "學生趨勢 PDF 下載失敗，請重試。");
    } finally { setStudentPdfExporting(false); }
  }
  async function loadBackup(file: File) {
    if (file.size > 1_500_000) { setMessage("備份檔案過大，請選擇本 App 的 JSON 備份。"); return; }
    try {
      const parsed = JSON.parse(await file.text());
      const backup = parsed && typeof parsed === "object" && "document" in parsed ? parsed.document : parsed;
      if (!validDocument(backup)) throw new Error("備份格式不正確");
      setLegacy(backup);
      setMessage("備份已讀取，請按上方提示的「匯入舊資料」。");
    } catch { setMessage("無法讀取 JSON 備份，請檢查檔案格式。"); }
  }
  function importLegacy() {
    if (!legacy) return;
    const newClasses = legacy.classes.filter(older => !doc.classes.some(current => current.id === older.id));
    const newExams = legacy.exams.filter(older => !doc.exams.some(current => current.id === older.id));
    if (!newClasses.length && !newExams.length) { setLegacy(null); setMessage("這份舊資料已在目前帳戶內。"); return; }
    if (doc.classes.length + newClasses.length > 100 || doc.exams.length + newExams.length > 300) { setMessage("舊資料超出班別或考試上限。"); return; }
    if (!change(d => { d.classes.push(...newClasses); d.exams.push(...newExams); })) return;
    setClassId(newClasses[0]?.id || legacy.classes[0]?.id || classId); setExamId(newExams[0]?.id || examId); setLegacy(null);
    pendingLegacyRef.current = legacy.classes.map(c => c.id);
    setMessage("舊版班別與考試已加入，正在儲存至雲端。");
  }

  const overallGrade = studentAnalysis.overall
    ? studentAnalysis.overall.lower === studentAnalysis.overall.upper
      ? showLevel(studentAnalysis.overall.lower)
      : `${showLevel(studentAnalysis.overall.lower)}–${showLevel(studentAnalysis.overall.upper)}`
    : "待有考試等級";
  const studentAnalysisPanel = studentAnalysisOpen && <div className="student-analysis">
    <div className="student-analysis-controls">
      <label className="small-label">搜尋學生<input type="search" aria-label="搜尋班內學生" value={studentAnalysisQuery} onChange={event => setStudentAnalysisQuery(event.target.value)} placeholder="輸入學生姓名"/></label>
      <label className="small-label">選擇學生<select aria-label="選擇分析學生" value={selectedStudent?.id ?? ""} onChange={event => setStudentAnalysisId(event.target.value)}><option value="">請選擇學生</option>{studentOptions.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
    </div>
    {selectedStudent ? <>
      <div className="student-analysis-summary"><div><span>多次考試平均分</span><strong>{studentAnalysis.average === null ? "—" : studentAnalysis.average.toFixed(2)}</strong><small>{studentAnalysis.scoreCount} 次有效分數</small></div><div><span>總預測等級</span><strong>{overallGrade}</strong><small>{studentAnalysis.gradedCount} 次有預測等級</small></div></div>
      <p className="student-analysis-note">總預測取最近最多 5 次有分數及已設定 grading 的考試，較近期考試權重較高；落在兩級之間便顯示等級範圍。平均分計算所有有效分數，缺考不計。</p>
      <div className="student-analysis-chart-head"><h3>{selectedStudent.name}的考試趨勢</h3><div className="student-analysis-chart-actions"><button className="button outline" onClick={() => void exportStudentPdf()} disabled={studentPdfExporting} aria-busy={studentPdfExporting}>{studentPdfExporting ? "正在製作 PDF…" : "下載學生趨勢 PDF"}</button><div className="segmented" aria-label="學生趨勢指標"><button className={studentAnalysisView === "score" ? "selected" : ""} onClick={() => setStudentAnalysisView("score")}>分數</button><button className={studentAnalysisView === "grade" ? "selected" : ""} onClick={() => setStudentAnalysisView("grade")}>預測等級</button></div></div></div>
      {studentAnalysis.records.length ? <><StudentHistoryChart summary={studentAnalysis} metric={studentAnalysisView}/><div className="student-analysis-table"><table><thead><tr><th>考試</th><th>分數</th><th>預測等級</th></tr></thead><tbody>{studentAnalysis.records.map(record => <tr key={record.id}><td>{record.name}</td><td>{record.kind === "abs" ? "ABS 缺考" : record.kind === "blank" ? "未填" : record.kind === "invalid" ? "分數無效" : record.score}</td><td>{record.gradeIndex !== null ? showLevel(record.grade) : record.kind === "valid" ? "待設定" : "—"}</td></tr>)}</tbody></table></div></> : <p className="help">此班別尚未建立考試。</p>}
    </> : <p className="help">搜尋並選擇一位學生，查看他的考試紀錄與綜合預測。</p>}
  </div>;

  if (status === "loading") return <div className="loading">正在讀取你的班別和成績…</div>;
  return <div className="app-shell">
    <header className="topbar"><div className="identity"><span className="logo mini">▥</span><div><strong>成績分析室</strong><small>GRADE STUDIO</small></div></div><div className="account"><span className={`save-state ${status}`}>● {statusText}</span><span className="account-name">{displayName}</span>{onGoogleSignIn && <button className="logout-button" disabled={status !== "saved"} onClick={() => void onGoogleSignIn()}>改用 Google</button>}{onGoogleSignOut ? <button className="logout-button" disabled={status !== "saved"} onClick={() => void onGoogleSignOut()}>登出</button> : <a href={signOutPath} target="_top">登出</a>}</div></header>
    <main className="content">
      {legacy && <div className="notice"><span>找到可匯入的舊版班別或備份資料；原有資料會保留。</span><button onClick={importLegacy}>匯入舊資料</button><button aria-label="關閉提示" onClick={() => setLegacy(null)}>×</button></div>}
      {(status === "error" || status === "conflict") && <div className="notice warn"><span>{message}</span><button onClick={() => download(JSON.stringify(currentRef.current, null, 2), "成績分析室未儲存資料.json", "application/json")}>下載目前內容</button>{status === "error" ? <button onClick={() => void flush()}>重試儲存</button> : <button onClick={() => location.reload()}>載入最新版本</button>}</div>}
      <div className="page-top admin-page-top"><div><p className="eyebrow">管理員 · 我的成績管理</p><h1>班別與考試</h1><p>名單建立一次，之後只需選考試、輸入分數。</p></div><div className="backup-actions"><button className="text-button" onClick={() => download(JSON.stringify(currentRef.current, null, 2), "成績分析室資料備份.json", "application/json")}>下載 JSON 備份</button><label className="text-button backup-import">匯入舊版 JSON 備份<input type="file" accept=".json,application/json" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void loadBackup(file); }}/></label></div></div>
      <section className="selection panel"><div className="select-row"><label>班別<select aria-label="選擇班別" value={classId} onChange={e => { const id = e.target.value; setClassId(id); setExamId(doc.exams.find(x => x.classId === id)?.id || ""); setSearch(""); setComparisonOpen(false); setComparisonExamIds([]); setExamOrderOpen(false); setStudentAnalysisOpen(false); setStudentAnalysisId(""); setStudentAnalysisQuery(""); }}><option value="">請選擇班別</option>{doc.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="button outline" onClick={() => setNewClass(v => !v)}>＋ 新班別</button>{klass && <><button className="button delete-record" onClick={deleteClass}>刪除班別</button><label>考試<select aria-label="選擇考試" value={examId} onChange={e => { setExamId(e.target.value); setSearch(""); }}><option value="">請選擇考試</option>{exams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><button className="button outline" onClick={addExam}>＋ 新考試</button>{exam && <button className="button delete-record" onClick={deleteExam}>刪除考試</button>}<button className="button outline" onClick={() => setExamOrderOpen(open => !open)} aria-expanded={examOrderOpen}>調整次序 {examOrderOpen ? "⌃" : "⌄"}</button><button className="button outline compare-trigger" onClick={() => { if (!comparisonOpen) setComparisonExamIds(exams.map(item => item.id)); setComparisonOpen(open => !open); }} aria-expanded={comparisonOpen}>比較考試 {comparisonOpen ? "⌃" : "⌄"}</button></>}</div>
        {examOrderOpen && klass && <div className="exam-order-panel"><p>由上至下為考試先後次序；學生趨勢和比較圖表會跟隨此順序。</p><ol>{exams.map((item, index) => <li key={item.id}><span>{item.name}</span><div><button type="button" aria-label={`將 ${item.name} 移前`} title="移前" disabled={index === 0 || status === "conflict"} onClick={() => reorderExam(item.id, -1)}>↑</button><button type="button" aria-label={`將 ${item.name} 移後`} title="移後" disabled={index === exams.length - 1 || status === "conflict"} onClick={() => reorderExam(item.id, 1)}>↓</button></div></li>)}</ol></div>}
        {newClass && <form className="inline-form" onSubmit={e => { e.preventDefault(); addClass(); }}><input aria-label="新班別名稱" autoFocus maxLength={100} value={className} onChange={e => setClassName(e.target.value)} placeholder="例如：5A 班"/><button className="button primary">建立班別</button><button type="button" className="button ghost" onClick={() => setNewClass(false)}>取消</button></form>}
        {comparisonOpen && klass && <div className="comparison-panel"><div className="comparison-head"><div><p className="eyebrow">同一班別的多次考試</p><h2>考試趨勢</h2></div><div className="segmented" aria-label="比較指標"><button className={comparisonMetric === "average" ? "selected" : ""} onClick={() => setComparisonMetric("average")}>平均分</button><button className={comparisonMetric === "passRate" ? "selected" : ""} onClick={() => setComparisonMetric("passRate")}>合格率（50 分或以上）</button></div></div><p className="comparison-note">勾選至少兩次考試。平均分及合格率只計算有有效分數的學生。</p><div className="comparison-choices"><button className="text-button" onClick={() => setComparisonExamIds(exams.map(item => item.id))}>全選</button><button className="text-button" onClick={() => setComparisonExamIds([])}>清除</button>{exams.map(item => <label key={item.id}><input type="checkbox" checked={comparisonExamIds.includes(item.id)} onChange={e => setComparisonExamIds(previous => e.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))}/>{item.name}</label>)}</div>{comparison.length < 2 ? <p className="help">請選擇至少兩次考試以顯示趨勢圖表。</p> : <ExamTrendChart items={comparison} metric={comparisonMetric}/>}</div>}
      </section>
      {!klass ? <section className="empty panel"><h2>先建立一個班別</h2><p>例如「5A 班」。建立後把學生姓名貼進名單，往後每次考試都可直接使用。</p><button className="button primary" onClick={() => setNewClass(true)}>建立班別</button></section> : <>
        <section className="roster-section panel"><div className="section-head"><div><p className="eyebrow">學生名單 · {klass.students.length} 位</p><h2>{klass.name}</h2></div><div className="roster-actions"><button className="button outline" onClick={() => setStudentAnalysisOpen(open => !open)} aria-expanded={studentAnalysisOpen}>{studentAnalysisOpen ? "收起學生趨勢" : "查詢學生趨勢"}</button><button className="button primary" disabled={manualSaving || status === "conflict"} onClick={() => void saveRoster()}>{manualSaving ? "儲存中…" : "儲存班別及名單"}</button><button className="text-button" onClick={() => setRosterOpen(v => !v)}>{rosterOpen ? "收起名單" : "管理名單"} {rosterOpen ? "⌃" : "⌄"}</button></div></div>{studentAnalysisPanel}{rosterOpen && <div className="roster-body"><label className="small-label">班別名稱<input value={classNameDraft?.id === klass.id ? classNameDraft.value : klass.name} maxLength={100} onChange={e => setClassNameDraft({ id: klass.id, value: e.target.value })} onBlur={e => commitClassName(klass.id, e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}/></label><div className="roster-entry"><div><label className="small-label">新增學生（每行一位）</label><textarea aria-label="新增學生姓名" value={studentNames} onChange={e => setStudentNames(e.target.value)} placeholder={"陳同學\n李同學\n黃同學"} rows={4}/></div><button className="button primary" onClick={importStudents}>加入名單</button></div><p className="roster-hint">在姓名旁填入學生的 Google 電郵；學生登入後只會看到與該電郵配對的紀錄。</p>{klass.students.length > 0 && <div className="roster-list">{klass.students.map((student, i) => <div key={student.id}><span>{i + 1}</span><input aria-label={`第 ${i + 1} 位學生姓名`} value={student.name} maxLength={120} onChange={e => { const value = e.target.value; if (!value.trim()) return; change(d => { d.classes.find(c => c.id === klass.id)!.students[i].name = value; }); }}/><input type="email" inputMode="email" autoComplete="off" aria-label={`${student.name} 的 Google 電郵`} placeholder="學生 Google 電郵" maxLength={254} value={emailDrafts[student.id] ?? student.email ?? ""} onChange={e => setEmailDrafts(previous => ({ ...previous, [student.id]: e.target.value }))} onBlur={e => commitStudentEmail(student.id, e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}/><button aria-label={`移除 ${student.name}`} onClick={() => { if (confirm(`移除 ${student.name}？此學生在本班所有考試的分數也會移除。`)) change(d => { const c = d.classes.find(x => x.id === klass.id)!; c.students = c.students.filter(s => s.id !== student.id); d.exams.filter(x => x.classId === klass.id).forEach(x => delete x.scores[student.id]); }); }}>×</button></div>)}</div>}</div>}</section>
        {!exam ? <section className="empty panel"><h2>選擇或建立考試</h2><p>學生姓名已在班別名單內。每次考試只需填分數與 grading 分界。</p><button className="button primary" onClick={addExam}>＋ 建立考試</button></section> : <>
          <div className="exam-title"><label>考試名稱<input aria-label="考試名稱" maxLength={100} value={examNameDraft?.id === exam.id ? examNameDraft.value : exam.name} onChange={e => setExamNameDraft({ id: exam.id, value: e.target.value })} onBlur={e => commitExamName(exam.id, e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}/></label><div className="export-actions"><button className="button outline" onClick={exportCsv}>匯出 CSV</button><button className="button outline" onClick={() => void exportPdf()} disabled={pdfExporting} aria-busy={pdfExporting}>{pdfExporting ? "正在製作 PDF…" : "下載 PDF"}</button></div></div>
          <section className="metrics"><div><span>已輸入</span><strong>{report.count}<small> / {klass.students.length} 位</small></strong></div><div><span>平均分</span><strong>{report.average === null ? "—" : report.average.toFixed(2)}</strong></div><div><span>最高分</span><strong>{report.max === null ? "—" : report.max}</strong></div><div><span>50 分或以上</span><strong>{report.count ? `${(report.at50 / report.count * 100).toFixed(1)}%` : "—"}</strong></div><div><span>缺考 ABS</span><strong>{report.absent}</strong></div></section>
          <div className="main-grid"><section className="panel scores-panel"><div className="section-head"><div><p className="eyebrow">成績輸入</p><div className="score-heading"><h2>學生分數</h2><select aria-label="學生分數排序" value={scoreOrder} onChange={e => { setScoreOrder(e.target.value as "roster" | "rank"); setRankOrderWhileEditing(null); }}><option value="roster">名單順序</option><option value="rank">排名順序</option></select></div></div><button className="text-button" onClick={() => setPasteOpen(v => !v)}>{pasteOpen ? "收起" : "批量貼上分數"}</button></div>{pasteOpen && <div className="paste-block"><p>從 Excel 複製一欄分數，按下方名單順序貼上；空行代表該學生留空，輸入 / 代表缺考。</p><textarea aria-label="批量貼上分數" value={scorePaste} onChange={e => setScorePaste(e.target.value)} rows={5} placeholder={"72.5\n86\n\n64"}/><button className="button primary" onClick={pasteScores}>填入分數</button></div>}{report.invalid > 0 && <p className="invalid-note">{report.invalid} 筆分數不正確，暫未計入統計。</p>}<div className="table-filter"><span>共 {klass.students.length} 位學生 · 輸入 / 代表缺考</span><input aria-label="搜尋姓名或等級" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋姓名或等級"/></div><div className="table-scroll"><table><thead><tr><th>排名</th><th>姓名</th><th>分數</th><th>預測等級</th></tr></thead><tbody>{rows.length ? rows.map(r => <tr key={r.student.id}><td>{rankByStudentId.get(r.student.id) ?? "—"}</td><td>{r.student.name}</td><td><input inputMode="text" aria-label={`${r.student.name} 分數`} className={r.kind === "invalid" ? "invalid-score" : ""} value={r.raw} onFocus={() => { if (scoreOrder === "rank") setRankOrderWhileEditing(rankedRows.map(({ row }) => row.student.id)); }} onBlur={() => setRankOrderWhileEditing(null)} onChange={e => { const raw = e.target.value; change(d => { d.exams.find(x => x.id === exam.id)!.scores[r.student.id] = raw; }); }} placeholder="分數 /"/></td><td>{r.grade ? <><span className="grade-pill">{r.grade}</span>{r.gapPercent !== null && <span className="grade-gap">距 {r.nextLevel} 尚差 {r.gapPercent}%</span>}</> : r.kind === "invalid" ? "分數無效" : r.kind === "valid" ? "待設定" : "—"}</td></tr>) : <tr><td colSpan={4} className="empty-table">{klass.students.length ? "找不到符合的學生" : "先在上方建立學生名單"}</td></tr>}</tbody></table></div></section>
          <aside className="aside-stack"><section className="panel"><div className="section-head"><div><p className="eyebrow">成績分佈</p><h2>即時統計</h2></div><div className="segmented"><button className={view === "bands" ? "selected" : ""} onClick={() => setView("bands")}>區間</button><button className={view === "grades" ? "selected" : ""} onClick={() => setView("grades")}>等級</button></div></div>{view === "grades" && !report.config.ready ? <p className="help">填妥下方 grading 分界，即可查看等級分佈。</p> : report.count ? <div className="bar-list">{counts.map((n, i) => <div key={i} className="bar-row"><span>{view === "grades" ? LEVELS[i] : i === 9 ? "90–100" : `${i * 10}–<${i * 10 + 10}`}</span><div><i style={{ width: `${n / chartMax * 100}%` }}/></div><b>{n}</b><small>{(n / report.count * 100).toFixed(1)}%</small></div>)}</div> : <p className="help">填入分數後，分佈會自動顯示。</p>}{view === "grades" && report.config.ready && report.count > 0 && <div className="cumulative-grades"><h3>累計達標比例</h3><p>U 為該級比例；「+」代表該級或以上。</p><div>{CUMULATIVE_LEVELS.map((label, i) => <span key={label}><b>{label}</b><strong>{(cumulativeGrades[i] / report.count * 100).toFixed(1)}%</strong></span>)}</div></div>}</section><section className="panel"><div className="section-head"><div><p className="eyebrow">預測等級</p><h2>Grading 分界</h2></div><button className="text-button" onClick={() => setGradesOpen(v => !v)}>{gradesOpen ? "收起" : "設定"} {gradesOpen ? "⌃" : "⌄"}</button></div><p className={`grading-status ${report.config.ready ? "ready" : ""}`}>{report.config.message}</p>{gradesOpen && <><div className="grading-preset"><p>{hasGradingDefault ? "這個班別已有預設；新考試會自動帶入，現有考試可獨立修改。" : "設定好這次考試的分界後，可儲存為班別預設，供新考試自動帶入。"}</p><div className="grading-preset-actions"><button className="button outline" disabled={!report.config.ready || status === "conflict"} onClick={() => void saveGradingDefault()}>{hasGradingDefault ? "更新班別預設" : "儲存為班別預設"}</button>{hasGradingDefault && <><button className="button outline" disabled={examUsesDefault || status === "conflict"} onClick={applyGradingDefault}>套用班別預設</button><button className="text-button" disabled={status === "conflict"} onClick={clearGradingDefault}>清除預設</button></>}</div></div><div className="threshold-head"><span>等級</span><span>最低分（含）</span><span>最高分</span></div>{LEVELS.map((level, i) => <div className="threshold-row" key={level}><strong>{level}</strong><input aria-label={`${level} 級最低分`} inputMode="decimal" value={exam.bounds[i]} readOnly={i === 0} onChange={e => { const value = e.target.value; change(d => { d.exams.find(x => x.id === exam.id)!.bounds[i] = value; }); }}/><span>{i === 7 ? "≤ 100" : exam.bounds[i + 1] ? `< ${exam.bounds[i + 1]}` : "待填"}</span></div>)}<p className="fine-print">分界含最低分、不含下一級最低分；5** 包括 100 分。</p></>}</section></aside></div>
        </>}
      </>}
      {message && status !== "error" && status !== "conflict" && <div className="toast" role="status"><span>{message}</span><button aria-label="關閉提示" onClick={() => setMessage("")}>×</button></div>}
    </main>
  </div>;
}
