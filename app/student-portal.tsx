"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LEVELS, summarizeStudentRecords, type recordsForEmail } from "../lib/grade";
import { downloadStudentTrendPdf } from "../lib/pdf-student-download";
import type { GradeBackend } from "../lib/grade-backend";

type StudentData = ReturnType<typeof recordsForEmail>;
type Props = { displayName: string; email: string; getGoogleToken: () => Promise<string>; onSignOut: () => Promise<void>; backend?: GradeBackend };

function ScoreTrend({ records }: { records: StudentData["records"] }) {
  const valid = records.filter(record => record.value !== null);
  if (!valid.length) return <p className="help">尚未有可計算的分數。缺考及未填分數不計入趨勢。</p>;
  const points = valid.map((record, index) => ({
    x: valid.length === 1 ? 500 : 55 + index * 890 / (valid.length - 1),
    y: 190 - record.value! * 1.5,
    record,
  }));
  return <div className="student-chart"><svg viewBox="0 0 1000 230" role="img" aria-label={`成績趨勢，由 ${valid[0].value} 分至 ${valid[valid.length - 1].value} 分`}>
    {[0, 50, 100].map(score => <g key={score}><line x1="55" x2="945" y1={190 - score * 1.5} y2={190 - score * 1.5} stroke="#dfe8df" strokeWidth="1"/><text x="9" y={194 - score * 1.5} fill="#758177" fontSize="15">{score}</text></g>)}
    {points.length > 1 && <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#1f5947" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>}
    {points.map((point, index) => <circle key={`${point.record.order}-${index}`} cx={point.x} cy={point.y} r="6" fill="#1f5947"><title>{point.record.examName}：{point.record.value} 分</title></circle>)}
  </svg><div className="chart-caption"><span>{valid[0].examName}</span><span>按考試建立順序 · 缺考不計算</span><span>{valid[valid.length - 1].examName}</span></div></div>;
}

export default function StudentPortal({ displayName, email, getGoogleToken, onSignOut, backend }: Props) {
  const [data, setData] = useState<StudentData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (backend) setData(await backend.loadStudent(email));
      else {
        const token = await getGoogleToken();
        const response = await fetch("/api/student", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
        const result = await response.json() as StudentData & { error?: string };
        if (!response.ok) throw new Error(result.error || "讀取成績失敗");
        setData(result as StudentData);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "讀取成績失敗"); }
    finally { setLoading(false); }
  }, [getGoogleToken, backend, email]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const valid = data?.records.filter(record => record.value !== null) ?? [];
  const average = valid.length ? valid.reduce((sum, record) => sum + record.value!, 0) / valid.length : null;
  const highest = valid.length ? Math.max(...valid.map(record => record.value!)) : null;
  const latest = valid.at(-1)?.value ?? null;
  const trendSummary = useMemo(() => summarizeStudentRecords((data?.records ?? []).map((record, index) => {
    const gradeIndex = LEVELS.findIndex(level => level === record.grade);
    return { id: String(index), name: record.examName, className: record.className, kind: record.kind, score: record.value, grade: record.grade, gradeIndex: gradeIndex < 0 ? null : gradeIndex };
  })), [data]);

  async function exportPdf() {
    if (!data?.linked || pdfExporting) return;
    setPdfExporting(true); setPdfError("");
    try {
      const studentName = data.records[0]?.studentName || displayName;
      const classes = [...new Set(data.records.map(record => record.className))];
      await downloadStudentTrendPdf(studentName, classes.join("、") || "我的考試", trendSummary);
    } catch (cause) { setPdfError(cause instanceof Error ? `PDF 下載失敗：${cause.message}` : "PDF 下載失敗，請重試。"); }
    finally { setPdfExporting(false); }
  }

  return <div className="app-shell student-portal">
    <header className="topbar"><div className="identity"><span className="logo mini">▥</span><div><strong>成績分析室</strong><small>GRADE STUDIO</small></div></div><div className="account"><span className="account-name">{displayName}</span><button className="logout-button" onClick={() => void onSignOut()}>登出</button></div></header>
    <main className="content">
      <div className="page-top"><div><p className="eyebrow">我的成績</p><h1>考試紀錄與成績趨勢</h1><p>以 Google 帳戶 {email} 查閱。只有與這個電郵相符的成績會顯示。</p></div><div className="student-page-actions">{data?.linked && <button className="button primary" onClick={() => void exportPdf()} disabled={loading || pdfExporting} aria-busy={pdfExporting}>{pdfExporting ? "正在製作 PDF…" : "下載我的趨勢 PDF"}</button>}<button className="button outline" onClick={() => void load()} disabled={loading}>重新整理</button></div></div>
      {pdfError && <div className="notice warn" role="alert">{pdfError}</div>}
      {loading ? <section className="panel student-empty">正在讀取你的成績…</section> : error ? <section className="panel student-empty"><h2>暫時無法讀取</h2><p>{error}</p><button className="button outline" onClick={() => void load()}>重試</button></section> : !data?.linked ? <section className="panel student-empty"><h2>尚未找到你的成績</h2><p>請老師在學生名單中填入你的 Google 帳戶電郵：{email}</p></section> : <>
        <section className="student-metrics"><div className="panel"><span>考試紀錄</span><strong>{data.records.length}</strong></div><div className="panel"><span>平均分</span><strong>{average === null ? "—" : average.toFixed(2)}</strong></div><div className="panel"><span>最高分</span><strong>{highest === null ? "—" : highest}</strong></div><div className="panel"><span>最近分數</span><strong>{latest === null ? "—" : latest}</strong></div></section>
        <section className="panel student-section"><p className="eyebrow">分數變化</p><h2>整體成績趨勢</h2><ScoreTrend records={data.records}/></section>
        <section className="panel student-section"><p className="eyebrow">所有考試</p><h2>考試紀錄</h2>{data.records.length ? <div className="student-records"><table><thead><tr><th>考試</th><th>班別</th><th>分數</th><th>預測等級</th></tr></thead><tbody>{[...data.records].reverse().map(record => <tr key={`${record.order}-${record.className}`}><td>{record.examName}</td><td>{record.className}</td><td>{record.kind === "abs" ? "ABS 缺考" : record.kind === "blank" ? "未填" : record.kind === "invalid" ? "分數待核對" : record.score}</td><td>{record.grade ? <><span className="grade-pill">{record.grade}</span>{record.gapPercent !== null && <span className="grade-gap">距 {record.nextLevel} 尚差 {record.gapPercent}%</span>}</> : record.kind === "valid" ? "待設定" : "—"}</td></tr>)}</tbody></table></div> : <p className="help">老師已加入你的電郵，但尚未建立考試紀錄。</p>}</section>
      </>}
    </main>
  </div>;
}
