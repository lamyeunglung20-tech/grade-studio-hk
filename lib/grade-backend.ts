import type { Document } from "./grade";
import type { recordsForEmail } from "./grade";

export type LoadedDocument = { revision: number; document: Document; legacyDocument?: Document };
export type StudentData = ReturnType<typeof recordsForEmail>;

export class RevisionConflictError extends Error {
  constructor() { super("資料已在另一分頁更新"); }
}

export type GradeBackend = {
  loadDocument: () => Promise<LoadedDocument>;
  saveDocument: (revision: number, document: Document) => Promise<{ revision: number }>;
  loadStudent: (email: string) => Promise<StudentData>;
};
