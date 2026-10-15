import { env } from "cloudflare:workers";
import { getRequestUser } from "../../auth";
import { ADMIN_OWNER_ID, isStudent } from "../../../lib/access";
import { recordsForEmail, validDocument } from "../../../lib/grade";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return json({ error: "請先使用 Google 登入" }, 401);
  if (!isStudent(user)) return json({ error: "請使用學生 Google 帳戶" }, 403);
  const row = await env.DB!.prepare("SELECT payload FROM owner_documents WHERE owner_id = ?").bind(ADMIN_OWNER_ID).first<{ payload: string }>();
  if (!row) return json({ linked: false, records: [] });
  let document: unknown;
  try { document = JSON.parse(row.payload); } catch { return json({ error: "成績資料暫時無法讀取" }, 500); }
  if (!validDocument(document)) return json({ error: "成績資料暫時無法讀取" }, 500);
  return json(recordsForEmail(document, user.email));
}
