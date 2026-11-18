/**
 * Course projections (docs/design/courses.md): event -> table logic and read queries.
 * `applyCourseEvent` is called from `applyEvent`, so live appends and `rebuild()` share it.
 */
import type { Block, BookExercise, Course, Unit, UnitWord } from "@app/core";
import type { AppEvent, BookAnswerRecord, CourseRecord, SqlDriver, SqlValue } from "./types.js";

type CourseEvent = Extract<
  AppEvent,
  {
    type:
      | "CourseImported"
      | "CourseDeleted"
      | "UnitDefined"
      | "UnitEdited"
      | "BlocksExtracted"
      | "BookExerciseExtracted"
      | "BookExerciseEdited"
      | "UnitWordsSet"
      | "BookExerciseAnswered";
  }
>;

const COURSE_TABLES = [
  "course_units",
  "course_blocks",
  "book_exercises",
  "unit_words",
  "book_answers",
] as const;

const CHUNK = 50;
const json = <T>(v: SqlValue | undefined): T => JSON.parse(String(v)) as T;

async function insertRows(
  driver: SqlDriver,
  head: string,
  cols: number,
  rows: readonly SqlValue[][],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const ph = `(${Array(cols).fill("?").join(",")})`;
    await driver.exec(`${head} VALUES ${Array(chunk.length).fill(ph).join(",")}`, chunk.flat());
  }
}

/** Apply one course event to the projection tables (inside the caller's transaction). */
export async function applyCourseEvent(
  driver: SqlDriver,
  createdAt: number,
  e: CourseEvent,
): Promise<void> {
  switch (e.type) {
    case "CourseImported":
      await driver.exec("INSERT OR REPLACE INTO courses (id, data, created_at) VALUES (?,?,?)", [
        e.course.id,
        JSON.stringify(e.course),
        createdAt,
      ]);
      return;
    case "CourseDeleted":
      await driver.exec("DELETE FROM courses WHERE id = ?", [e.courseId]);
      for (const t of COURSE_TABLES) {
        await driver.exec(`DELETE FROM ${t} WHERE course_id = ?`, [e.courseId]);
      }
      return;
    case "UnitDefined":
      if (!(await courseExists(driver, e.courseId))) return;
      await driver.exec("DELETE FROM course_units WHERE course_id = ?", [e.courseId]);
      await insertRows(
        driver,
        "INSERT INTO course_units (course_id, n, data)",
        3,
        e.units.map((u) => [e.courseId, u.n, JSON.stringify(u)]),
      );
      return;
    case "UnitEdited": {
      const rows = await driver.exec(
        "SELECT data FROM course_units WHERE course_id = ? AND n = ?",
        [e.courseId, e.n],
      );
      if (!rows[0]) return;
      const unit = { ...json<Unit>(rows[0]["data"]), ...e.patch };
      await driver.exec("UPDATE course_units SET data = ? WHERE course_id = ? AND n = ?", [
        JSON.stringify(unit),
        e.courseId,
        e.n,
      ]);
      return;
    }
    case "BlocksExtracted":
      if (!(await courseExists(driver, e.courseId))) return;
      await driver.exec("DELETE FROM course_blocks WHERE course_id = ?", [e.courseId]);
      await insertRows(
        driver,
        "INSERT INTO course_blocks (course_id, idx, page, data)",
        4,
        e.blocks.map((b, i) => [e.courseId, i, b.page, JSON.stringify(b)]),
      );
      return;
    case "BookExerciseExtracted":
      if (!(await courseExists(driver, e.courseId))) return;
      await driver.exec("DELETE FROM book_exercises WHERE course_id = ? AND unit_n = ?", [
        e.courseId,
        e.unitN,
      ]);
      await insertRows(
        driver,
        "INSERT OR REPLACE INTO book_exercises (course_id, unit_n, number, idx, data)",
        5,
        e.exercises.map((x, i) => [e.courseId, e.unitN, x.number, i, JSON.stringify(x)]),
      );
      return;
    case "BookExerciseEdited": {
      const rows = await driver.exec(
        "SELECT data FROM book_exercises WHERE course_id = ? AND unit_n = ? AND number = ?",
        [e.courseId, e.unitN, e.number],
      );
      if (!rows[0]) return;
      const ex = { ...json<BookExercise>(rows[0]["data"]), ...e.patch };
      await driver.exec(
        "UPDATE book_exercises SET data = ? WHERE course_id = ? AND unit_n = ? AND number = ?",
        [JSON.stringify(ex), e.courseId, e.unitN, e.number],
      );
      return;
    }
    case "UnitWordsSet":
      if (!(await courseExists(driver, e.courseId))) return;
      await driver.exec("DELETE FROM unit_words WHERE course_id = ? AND unit_n = ?", [
        e.courseId,
        e.unitN,
      ]);
      await insertRows(
        driver,
        "INSERT INTO unit_words (course_id, unit_n, idx, data)",
        4,
        e.words.map((w, i) => [e.courseId, e.unitN, i, JSON.stringify(w)]),
      );
      return;
    case "BookExerciseAnswered": {
      // The newest answer per item wins, whatever order events arrive in.
      const rows = await driver.exec(
        "SELECT at FROM book_answers WHERE course_id=? AND unit_n=? AND number=? AND item=?",
        [e.courseId, e.unitN, e.number, e.item],
      );
      if (rows[0] && Number(rows[0]["at"]) > e.at) return;
      await driver.exec(
        "INSERT OR REPLACE INTO book_answers (course_id, unit_n, number, item, answer, correct, at) VALUES (?,?,?,?,?,?,?)",
        [e.courseId, e.unitN, e.number, e.item, e.answer, e.correct ? 1 : 0, e.at],
      );
      return;
    }
  }
}

async function courseExists(driver: SqlDriver, courseId: string): Promise<boolean> {
  return (await driver.exec("SELECT 1 AS x FROM courses WHERE id = ?", [courseId])).length > 0;
}

/** Read queries (unserialised: the repository wraps them in its mutex). */
export function courseQueries(driver: SqlDriver) {
  return {
    async courses(): Promise<CourseRecord[]> {
      const rows = await driver.exec("SELECT data FROM courses ORDER BY created_at DESC, id DESC");
      const units = await driver.exec("SELECT course_id, data FROM course_units ORDER BY n");
      return rows.map((r) => {
        const course = json<Course>(r["data"]);
        return {
          ...course,
          units: units
            .filter((u) => u["course_id"] === course.id)
            .map((u) => json<Unit>(u["data"])),
        };
      });
    },
    async courseBlocks(courseId: string): Promise<Block[]> {
      const rows = await driver.exec(
        "SELECT data FROM course_blocks WHERE course_id = ? ORDER BY idx",
        [courseId],
      );
      return rows.map((r) => json<Block>(r["data"]));
    },
    async unitExercises(courseId: string, unitN: number): Promise<BookExercise[]> {
      const rows = await driver.exec(
        "SELECT data FROM book_exercises WHERE course_id = ? AND unit_n = ? ORDER BY idx",
        [courseId, unitN],
      );
      return rows.map((r) => json<BookExercise>(r["data"]));
    },
    async unitWords(courseId: string, unitN: number): Promise<UnitWord[]> {
      const rows = await driver.exec(
        "SELECT data FROM unit_words WHERE course_id = ? AND unit_n = ? ORDER BY idx",
        [courseId, unitN],
      );
      return rows.map((r) => json<UnitWord>(r["data"]));
    },
    async generatedUnitExercises(courseId: string, unitN: number): Promise<BookExercise[]> {
      if (!(await courseExists(driver, courseId))) return [];
      const rows = await driver.exec(
        "SELECT payload FROM events WHERE type = 'UnitExercisesGenerated' AND json_extract(payload, '$.courseId') = ? AND json_extract(payload, '$.unitN') = ? ORDER BY id",
        [courseId, unitN],
      );
      return rows.flatMap((r) => json<{ exercises: BookExercise[] }>(r["payload"]).exercises);
    },
    async bookAnswers(courseId: string, unitN?: number): Promise<BookAnswerRecord[]> {
      const rows = await driver.exec(
        `SELECT unit_n, number, item, answer, correct, at FROM book_answers
          WHERE course_id = ?${unitN === undefined ? "" : " AND unit_n = ?"}
          ORDER BY unit_n, number, item`,
        unitN === undefined ? [courseId] : [courseId, unitN],
      );
      return rows.map((r) => ({
        unitN: Number(r["unit_n"]),
        number: Number(r["number"]),
        item: Number(r["item"]),
        answer: String(r["answer"]),
        correct: r["correct"] === 1,
        at: Number(r["at"]),
      }));
    },
  };
}
