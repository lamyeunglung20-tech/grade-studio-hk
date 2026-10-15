import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const ownerDocuments = sqliteTable("owner_documents", {
  ownerId: text("owner_id").primaryKey(),
  revision: integer("revision").notNull(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
