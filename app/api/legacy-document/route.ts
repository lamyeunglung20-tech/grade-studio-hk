import { env } from "cloudflare:workers";
import { getRequestUser } from "../../auth";
import { validDocument } from "../../../lib/grade";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return json({ error: "請先登入" }, 401);
  const row = await env.DB!.prepare("SELECT payload FROM owner_documents WHERE owner_id = ?").bind(user.userId).first<{ payload: string }>();
  if (!row) return json({ error: "這個帳戶沒有舊資料" }, 404);
  let document: unknown;
  try { document = JSON.parse(row.payload); } catch { return json({ error: "舊資料格式不正確" }, 500); }
  if (!validDocument(document)) return json({ error: "舊資料格式不正確" }, 500);
  return json({ document });
}
