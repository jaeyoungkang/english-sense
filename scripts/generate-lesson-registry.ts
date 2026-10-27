// 정본(content/reading.json, content/prep.json)에서 lib/lesson-registry-data.ts를 만든다.
// 사용: npx tsx scripts/generate-lesson-registry.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLessonData, renderLessonData } from "../lib/server/lesson-catalog";

writeFileSync(join(import.meta.dirname, "../lib/lesson-registry-data.ts"), renderLessonData(buildLessonData()));
