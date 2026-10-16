"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LEVELS, summarizeStudentRecords, type recordsForEmail } from "../lib/grade";
import { downloadStudentTrendPdf } from "../lib/pdf-student-download";
import type { GradeBackend } from "../lib/grade-backend";

type StudentData = ReturnType<typeof recordsForEmail>;
type Props = { displayName: string; email: string; getGoogleToken: () => Promise<string>; onSignOut: () => Promise<void>; backend?: GradeBackend };

function StudentTrend({ records, metric }: { records: StudentData["records"]; metric: "score" | "grade" }) {
  const valid = records.filter(record => metric === "score" ? record.value !== null : LEVELS.includes(record.grade as typeof LEVELS[number]));
  if (!valid.length) return <p className="help">{metric === "score" ? "尚未有可計算的分數。" : "尚未有可顯示的預測等級，請待老師設定 grading 分界。"}</p>;
  const gradeLabel = (grade: string) => grade === "U" ? "U" : `Lv${grade}`;
  const displayValue = (record: typeof valid[number]) => metric === "score" ? `${record.value} 分` : gradeLabel(record.grade);
  const ticks = metric === "score" ? [0, 50, 100] : LEVELS.map((_, index) => index);
  const yFor = (value: number) => 190 - value * (metric === "score" ? 1.5 : 150 / (LEVELS.length - 1));
  const points = valid.map((record, index) => ({
    x: valid.length === 1 ? 300 : 55 + index * 490 / (valid.length - 1),
    y: yFor(metric === "score" ? record.value! : LEVELS.indexOf(record.grade as typeof LEVELS[number])),
    record,
  }));
  return <div className="student-chart"><div className="student-chart-plot"><svg viewBox="0 0 600 230" role="img" aria-label={`${metric === "score" ? "分數" : "預測等級"}趨勢，由 ${displayValue(valid[0])} 至 ${displayValue(valid[valid.length - 1])}`}>
    {ticks.map(tick => <g key={tick}><line x1="55" x2="545" y1={yFor(tick)} y2={yFor(tick)} stroke="#dfe8df" strokeWidth="1"/><text x="5" y={yFor(tick) + 6} fill="#758177" fontSize="20">{metric === "score" ? tick : gradeLabel(LEVELS[tick])}</text></g>)}
    {points.length > 1 && <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#1f5947" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>}
    {points.map((point, index) => <g key={`${point.record.order}-${index}`}><circle cx={point.x} cy={point.y} r="7" fill="#1f5947"><title>{point.record.examName}：{displayValue(point.record)}</title></circle><text x={point.x} y="217" textAnchor="middle" fill="#758177" fontSize="20">{index + 1}</text></g>)}
  </svg></div><ol className="student-chart-exams" aria-label="圖表考試名稱">{valid.map((record, index) => <li key={`${record.order}-${index}`}><span className="student-chart-number">{index + 1}</span><span className="student-chart-exam-name">{record.examName}</span><strong>{displayValue(record)}</strong></li>)}</ol></div>;
}

export default function StudentPortal({ displayName, email, getGoogleToken, onSignOut, backend }: Props) {
  const [data, setData] = useState<StudentData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [trendMetric, setTrendMetric] = useState<"score" | "grade">("score");
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
  const studentName = data?.linked ? data.studentName || data.records[0]?.studentName || "" : "";
  const trendSummary = useMemo(() => summarizeStudentRecords((data?.records ?? []).map((record, index) => {
    const gradeIndex = LEVELS.findIndex(level => level === record.grade);
    return { id: String(index), name: record.examName, className: record.className, kind: record.kind, score: record.value, grade: record.grade, gradeIndex: gradeIndex < 0 ? null : gradeIndex };
  })), [data]);

  async function exportPdf() {
    if (!data?.linked || pdfExporting) return;
    setPdfExporting(true); setPdfError("");
    try {
      const classes = [...new Set(data.records.map(record => record.className))];
      await downloadStudentTrendPdf(studentName || displayName, classes.join("、") || "我的考試", trendSummary);
    } catch (cause) { setPdfError(cause instanceof Error ? `PDF 下載失敗：${cause.message}` : "PDF 下載失敗，請重試。"); }
    finally { setPdfExporting(false); }
  }

  return <div className="app-shell student-portal">
    <header className="topbar"><div className="identity"><span className="logo mini">▥</span><div><strong>成績分析室</strong><small>GRADE STUDIO</small></div></div><div className="account"><span className="account-name">{studentName || displayName}</span><button className="logout-button" onClick={() => void onSignOut()}>登出</button></div></header>
    <main className="content">
      <div className="page-top"><div><p className="eyebrow">我的成績</p><h1>{studentName ? `你好，${studentName}` : "考試紀錄與成績趨勢"}</h1><p>以 Google 帳戶 {email} 查閱。只有與這個電郵相符的成績會顯示。</p></div><div className="student-page-actions">{data?.linked && <button className="button primary" onClick={() => void exportPdf()} disabled={loading || pdfExporting} aria-busy={pdfExporting}>{pdfExporting ? "正在製作 PDF…" : "下載我的趨勢 PDF"}</button>}<button className="button outline" onClick={() => void load()} disabled={loading}>重新整理</button></div></div>
      {pdfError && <div className="notice warn" role="alert">{pdfError}</div>}
      {loading ? <section className="panel student-empty">正在讀取你的成績…</section> : error ? <section className="panel student-empty"><h2>暫時無法讀取</h2><p>{error}</p><button className="button outline" onClick={() => void load()}>重試</button></section> : !data?.linked ? <section className="panel student-empty"><h2>尚未找到你的成績</h2><p>請老師在學生名單中填入你的 Google 帳戶電郵：{email}</p></section> : <>
        <section className="student-metrics"><div className="panel"><span>考試紀錄</span><strong>{data.records.length}</strong></div><div className="panel"><span>平均分</span><strong>{average === null ? "—" : average.toFixed(2)}</strong></div><div className="panel"><span>最高分</span><strong>{highest === null ? "—" : highest}</strong></div><div className="panel"><span>最近分數</span><strong>{latest === null ? "—" : latest}</strong></div></section>
        <section className="panel student-section"><p className="eyebrow">分數變化</p><div className="student-trend-heading"><h2>{trendMetric === "score" ? "整體成績趨勢" : "預測等級趨勢"}</h2><div className="segmented" role="group" aria-label="趨勢指標"><button type="button" className={trendMetric === "score" ? "selected" : ""} aria-pressed={trendMetric === "score"} onClick={() => setTrendMetric("score")}>分數</button><button type="button" className={trendMetric === "grade" ? "selected" : ""} aria-pressed={trendMetric === "grade"} onClick={() => setTrendMetric("grade")}>預測等級</button></div></div><StudentTrend records={data.records} metric={trendMetric}/></section>
        <section className="panel student-section"><p className="eyebrow">所有考試</p><h2>考試紀錄</h2>{data.records.length ? <div className="student-records"><table><thead><tr><th>考試</th><th>班別</th><th>分數</th><th>預測等級</th></tr></thead><tbody>{[...data.records].reverse().map(record => <tr key={`${record.order}-${record.className}`}><td>{record.examName}</td><td>{record.className}</td><td>{record.kind === "abs" ? "ABS 缺考" : record.kind === "blank" ? "未填" : record.kind === "invalid" ? "分數待核對" : record.score}</td><td>{record.grade ? <><span className="grade-pill">{record.grade}</span>{record.gapPercent !== null && <span className="grade-gap">距 {record.nextLevel} 尚差 {record.gapPercent}%</span>}</> : record.kind === "valid" ? "待設定" : "—"}</td></tr>)}</tbody></table></div> : <p className="help">老師已加入你的電郵，但尚未建立考試紀錄。</p>}</section>
      </>}
    </main>
  </div>;
}
