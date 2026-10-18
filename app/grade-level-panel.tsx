"use client";

import { useMemo, useState } from "react";
import { analyzeGradeLevel, cumulativeGradeCounts, CUMULATIVE_LEVELS, LEVELS, type Document, type GradeGroup } from "../lib/grade";

type Props = {
  document: Document;
  initialClassId: string;
  onSave: (group: GradeGroup) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
};

const levelLabel = (level: string) => level === "U" ? "U" : `Lv${level}`;

export default function GradeLevelPanel({ document, initialClassId, onSave, onDelete }: Props) {
  const [groupId, setGroupId] = useState("");
  const [name, setName] = useState("");
  const [classIds, setClassIds] = useState<string[]>(initialClassId ? [initialClassId] : []);
  const [examIds, setExamIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeClassIds = useMemo(() => classIds.filter(id => document.classes.some(klass => klass.id === id)), [classIds, document.classes]);
  const examsFor = (classId: string) => document.exams.filter(exam => exam.classId === classId);
  const selections = useMemo(() => activeClassIds.map(classId => {
    const exams = document.exams.filter(exam => exam.classId === classId);
    const chosen = Object.hasOwn(examIds, classId) ? examIds[classId] : exams.at(-1)?.id ?? "";
    return { classId, examId: exams.some(exam => exam.id === chosen) ? chosen : "" };
  }), [activeClassIds, document.exams, examIds]);
  const complete = selections.length >= 2 && selections.every(item => !!item.examId);
  const result = useMemo(() => complete ? analyzeGradeLevel(document, selections) : null, [document, complete, selections]);
  const cumulative = result ? cumulativeGradeCounts(result.grades) : [];
  const maxGradeCount = Math.max(1, ...(result?.grades ?? []));

  function chooseGroup(id: string) {
    setGroupId(id); setMessage("");
    const group = document.gradeGroups?.find(item => item.id === id);
    setName(group?.name ?? "");
    setClassIds(group?.classIds ?? (initialClassId ? [initialClassId] : []));
    setExamIds(group?.examIds ?? {});
  }

  function toggleClass(id: string, selected: boolean) {
    setClassIds(previous => selected ? [...previous, id] : previous.filter(item => item !== id));
    setMessage("");
  }

  async function saveGroup() {
    const title = name.trim();
    if (!title) { setMessage("請先填寫年級名稱。"); return; }
    if (!complete) { setMessage("請選擇至少兩個班別，並為每班選擇考試。"); return; }
    const group: GradeGroup = { id: groupId || crypto.randomUUID(), name: title, classIds: activeClassIds, examIds: Object.fromEntries(selections.map(item => [item.classId, item.examId])) };
    setBusy(true);
    try {
      if (await onSave(group)) { setGroupId(group.id); setMessage("年級組合已儲存；下次登入仍可選用。"); }
      else setMessage("未能儲存年級組合，請檢查上方儲存狀態。");
    } finally { setBusy(false); }
  }

  async function deleteGroup() {
    if (!groupId || !confirm(`移除「${name}」的年級組合？班別、考試及分數會保留。`)) return;
    setBusy(true);
    try {
      if (await onDelete(groupId)) { chooseGroup(""); setMessage("年級組合已移除，原有成績不受影響。"); }
      else setMessage("未能移除年級組合，請檢查上方儲存狀態。");
    } finally { setBusy(false); }
  }

  return <section className="grade-level-panel panel" aria-label="年級統計">
    <div className="section-head"><div><p className="eyebrow">跨班別合併</p><h2>年級統計</h2></div><span className="grade-level-hint">每班可選一份考試，再合併計算</span></div>
    <div className="grade-level-controls">
      <label className="small-label">已儲存年級<select aria-label="選擇已儲存年級" value={groupId} onChange={event => chooseGroup(event.target.value)}><option value="">新年級組合</option>{(document.gradeGroups ?? []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="small-label">年級名稱<input aria-label="年級名稱" value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="例如：中五級化學"/></label>
    </div>
    <div className="grade-level-class-list">{document.classes.map(klass => <div key={klass.id} className="grade-level-class-row"><label><input type="checkbox" checked={activeClassIds.includes(klass.id)} onChange={event => toggleClass(klass.id, event.target.checked)}/><span>{klass.name}</span></label>{activeClassIds.includes(klass.id) && <select aria-label={`${klass.name}的考試`} value={selections.find(item => item.classId === klass.id)?.examId ?? ""} onChange={event => setExamIds(previous => ({ ...previous, [klass.id]: event.target.value }))}><option value="">請選擇考試</option>{examsFor(klass.id).map(exam => <option key={exam.id} value={exam.id}>{exam.name}</option>)}</select>}</div>)}</div>
    <div className="grade-level-actions"><button className="button primary" type="button" disabled={busy || !complete} onClick={() => void saveGroup()}>{busy ? "儲存中…" : groupId ? "更新年級組合" : "儲存年級組合"}</button>{groupId && <button className="button outline delete-record" type="button" disabled={busy} onClick={() => void deleteGroup()}>移除組合</button>}<span>{activeClassIds.length} 個班別已選</span></div>
    {message && <p className="grade-level-message" role="status">{message}</p>}
    {!complete ? <p className="help">請勾選至少兩個班別，並為每班選擇要統計的考試；如目前只有一班，可先新增另一個班別。</p> : result && <>
      <div className="grade-level-metrics"><div><span>已輸入</span><strong>{result.count}<small> / {result.students} 位</small></strong></div><div><span>平均分</span><strong>{result.average === null ? "—" : result.average.toFixed(2)}</strong></div><div><span>最高分</span><strong>{result.max === null ? "—" : result.max}</strong></div><div><span>50 分或以上</span><strong>{result.count ? `${(result.at50 / result.count * 100).toFixed(1)}%` : "—"}</strong></div><div><span>缺考 ABS</span><strong>{result.absent}</strong></div></div>
      <p className="grade-level-hint">平均分和合格率按所有有效分數計算，缺考及未填不計；每位學生的預測等級按所選考試的 grading 分界計算。</p>
      <div className="grade-level-results"><section><h3>預測等級分布</h3>{result.graded ? <><div className="bar-list">{LEVELS.map((level, index) => <div className="bar-row" key={level}><span>{levelLabel(level)}</span><div><i style={{ width: `${result.grades[index] / maxGradeCount * 100}%` }}/></div><b>{result.grades[index]}</b><small>{(result.grades[index] / result.graded * 100).toFixed(1)}%</small></div>)}</div><div className="cumulative-grades"><h3>累計達標比例</h3><p>以 {result.graded} 位已有預測等級的學生計算。</p><div>{CUMULATIVE_LEVELS.map((label, index) => <span key={label}><b>{label}</b><strong>{(cumulative[index] / result.graded * 100).toFixed(1)}%</strong></span>)}</div></div></> : <p className="help">所選考試尚未設定完整的 grading 分界。</p>}</section>
        <section><h3>全年級學生分數</h3><div className="grade-level-table"><table><thead><tr><th>排名</th><th>姓名</th><th>班別</th><th>分數</th><th>預測等級</th></tr></thead><tbody>{result.ranked.map(({ row, rank }) => <tr key={row.student.id}><td>{rank ?? "—"}</td><td>{row.student.name}</td><td>{row.className}</td><td>{row.kind === "abs" ? "ABS" : row.kind === "blank" ? "未填" : row.kind === "invalid" ? "待核對" : row.value}</td><td>{row.kind === "valid" ? row.grade ? levelLabel(row.grade) : "待設定" : "—"}</td></tr>)}</tbody></table></div></section></div>
    </>}
  </section>;
}
