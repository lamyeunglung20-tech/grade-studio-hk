import type { FirebaseApp } from "firebase/app";
import { doc, getDoc, getFirestore, runTransaction, serverTimestamp } from "firebase/firestore";
import { EMPTY, normalizeEmail, recordsForEmail, validDocument, type Document } from "./grade";
import { RevisionConflictError, type GradeBackend, type StudentData } from "./grade-backend";

const MAIN_DOCUMENT = "grade_documents/main";

function emailsIn(document: Document): string[] {
  return [...new Set(document.classes.flatMap(klass => klass.students.map(student => normalizeEmail(student.email)).filter(Boolean)))];
}

function studentRef(database: ReturnType<typeof getFirestore>, email: string) {
  // Google email addresses cannot use a slash as a Firestore document separator.
  if (email.includes("/")) throw new Error("學生電郵不能包含斜線；請修正名單後重試。");
  return doc(database, "student_views", email);
}

export function createFirebaseGradeBackend(app: FirebaseApp): GradeBackend {
  const database = getFirestore(app);
  const main = doc(database, MAIN_DOCUMENT);

  return {
    async loadDocument() {
      const snapshot = await getDoc(main);
      if (!snapshot.exists()) return { revision: 0, document: structuredClone(EMPTY) };
      const data = snapshot.data();
      const parsed: unknown = JSON.parse(data.payloadJson);
      if (!validDocument(parsed)) throw new Error("雲端資料格式不正確");
      return { revision: data.revision as number, document: parsed };
    },

    async saveDocument(revision, document) {
      if (!validDocument(document)) throw new Error("資料格式不正確，未能儲存。");
      const emails = emailsIn(document);
      if (emails.length > 450) throw new Error("學生電郵超過此雲端版本的每次儲存上限（450 位）。");
      const payloadJson = JSON.stringify(document);
      if (new Blob([payloadJson]).size > 950_000) throw new Error("資料超過 Firestore 單一紀錄上限；請匯出 JSON 備份後分拆班別。");

      try {
        return await runTransaction(database, async transaction => {
          const current = await transaction.get(main);
          const stored = current.exists() ? current.data() : null;
          const storedRevision = typeof stored?.revision === "number" ? stored.revision : 0;
          if (storedRevision !== revision) throw new RevisionConflictError();
          const oldEmails = Array.isArray(stored?.studentEmails) ? stored.studentEmails as string[] : [];
          if (new Set([...oldEmails, ...emails]).size > 499) throw new Error("本次更新的學生電郵過多，請分批儲存。");
          // One transaction keeps the teacher's document and students' private views in sync.
          for (const email of new Set([...oldEmails, ...emails])) {
            const view = studentRef(database, email);
            if (!emails.includes(email)) transaction.delete(view);
            else transaction.set(view, { dataJson: JSON.stringify(recordsForEmail(document, email)), updatedAt: serverTimestamp() });
          }
          transaction.set(main, { revision: revision + 1, payloadJson, studentEmails: emails, updatedAt: serverTimestamp() });
          return { revision: revision + 1 };
        });
      } catch (error) {
        if (error instanceof RevisionConflictError) throw error;
        throw new Error(error instanceof Error ? `雲端儲存失敗：${error.message}` : "雲端儲存失敗");
      }
    },

    async loadStudent(email) {
      const snapshot = await getDoc(studentRef(database, normalizeEmail(email)));
      if (!snapshot.exists()) return { linked: false, studentName: "", records: [] };
      const parsed: StudentData = JSON.parse(snapshot.data().dataJson);
      if (typeof parsed?.linked !== "boolean" || !Array.isArray(parsed.records)) throw new Error("學生紀錄格式不正確");
      return parsed;
    },
  };
}
