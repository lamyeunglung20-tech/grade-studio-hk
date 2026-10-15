import { getRequestUser } from "../../auth";
import { env } from "cloudflare:workers";
import { EMPTY, validDocument } from "../../../lib/grade";
import { ADMIN_OWNER_ID, isAdmin } from "../../../lib/access";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return json({ error: "請先登入" }, 401);
  if (!isAdmin(user)) return json({ error: "只有管理員可查閱班別資料" }, 403);
  let row = await env.DB!.prepare("SELECT revision, payload FROM owner_documents WHERE owner_id = ?").bind(ADMIN_OWNER_ID).first<{ revision: number; payload: string }>();
  const chatgptUser = await getChatGPTUser();
  const legacyOwnerIds = new Set([user.userId]);
  if (chatgptUser && isAdmin({ ...chatgptUser, provider: "chatgpt" })) legacyOwnerIds.add(chatgptUser.userId);
  const legacyDocuments: { revision: number; payload: string; document: unknown }[] = [];
  for (const ownerId of legacyOwnerIds) {
    if (ownerId === ADMIN_OWNER_ID) continue;
    const previous = await env.DB!.prepare("SELECT revision, payload FROM owner_documents WHERE owner_id = ?").bind(ownerId).first<{ revision: number; payload: string }>();
    if (!previous) continue;
    try {
      const document: unknown = JSON.parse(previous.payload);
      if (validDocument(document) && (document.classes.length || document.exams.length)) legacyDocuments.push({ ...previous, document });
    } catch { /* Ignore malformed legacy data. */ }
  }
  if (!row && legacyDocuments.length) {
    const previous = legacyDocuments[0];
    await env.DB!.prepare("INSERT INTO owner_documents (owner_id, revision, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO NOTHING")
      .bind(ADMIN_OWNER_ID, previous.revision + 1, previous.payload, Date.now()).run();
    row = await env.DB!.prepare("SELECT revision, payload FROM owner_documents WHERE owner_id = ?").bind(ADMIN_OWNER_ID).first<{ revision: number; payload: string }>();
  }
  const document = row ? JSON.parse(row.payload) : EMPTY;
  const legacyDocument = validDocument(document) ? legacyDocuments.map(item => item.document).find(oldDocument =>
    validDocument(oldDocument) && (oldDocument.classes.some(oldClass => !document.classes.some(current => current.id === oldClass.id)) ||
      oldDocument.exams.some(oldExam => !document.exams.some(current => current.id === oldExam.id)))) ?? null : null;
  return json({ revision: row?.revision ?? 0, document, legacyDocument });
}

export async function PUT(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return json({ error: "請先登入" }, 401);
  if (!isAdmin(user)) return json({ error: "只有管理員可修改班別及成績" }, 403);
  if (request.headers.get("Origin") && request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "來源不符" }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "請使用 JSON" }, 415);
  const bodyText = await request.text();
  if (bodyText.length > 1_500_000) return json({ error: "資料過大，請減少考試資料" }, 413);
  let input: unknown;
  try { input = JSON.parse(bodyText); } catch { return json({ error: "資料格式不正確" }, 400); }
  if (!input || typeof input !== "object" || !("revision" in input) || !("document" in input)) return json({ error: "缺少資料" }, 400);
  const { revision, document } = input as { revision: unknown; document: unknown };
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || !validDocument(document)) return json({ error: "資料格式不正確" }, 400);
  const now = Date.now();
  // Preserve email links when an already-open older app saves a roster without the new field.
  const current = await env.DB!.prepare("SELECT payload FROM owner_documents WHERE owner_id = ?").bind(ADMIN_OWNER_ID).first<{ payload: string }>();
  if (current) {
    try {
      const existing = JSON.parse(current.payload);
      if (validDocument(existing)) {
        const emails = new Map(existing.classes.flatMap(klass => klass.students.filter(student => student.email).map(student => [student.id, student.email!] as const)));
        for (const klass of (document as typeof existing).classes) for (const student of klass.students) if (student.email === undefined && emails.has(student.id)) student.email = emails.get(student.id);
      }
    } catch { /* Keep the validated incoming document. */ }
  }
  if (!validDocument(document)) return json({ error: "學生電郵重複或資料格式不正確" }, 400);
  const payload = JSON.stringify(document);
  let changed: { revision: number } | null;
  if (revision === 0) {
    changed = await env.DB!.prepare("INSERT INTO owner_documents (owner_id, revision, payload, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(owner_id) DO NOTHING RETURNING revision").bind(ADMIN_OWNER_ID, payload, now).first<{ revision: number }>();
  } else {
    changed = await env.DB!.prepare("UPDATE owner_documents SET revision = revision + 1, payload = ?, updated_at = ? WHERE owner_id = ? AND revision = ? RETURNING revision").bind(payload, now, ADMIN_OWNER_ID, revision).first<{ revision: number }>();
  }
  if (changed) return json({ revision: changed.revision });
  const latest = await env.DB!.prepare("SELECT revision FROM owner_documents WHERE owner_id = ?").bind(ADMIN_OWNER_ID).first<{ revision: number }>();
  return json({ error: "資料已在其他分頁更新", revision: latest?.revision ?? 0 }, 409);
}
