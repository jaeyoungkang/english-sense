import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const CANONICAL = new Set(["content/reading.json", "content/prep.json"]);
const SCANNED = ["app", "components", "lib", "worker.ts"];

/** 정본 JSON(정답·해설 포함)과 서버 전용 모듈을 브라우저 쪽 모듈이 import하지 못하게 한다. */
export function findImportViolations(files: Record<string, string>) {
  const known = Object.keys(files);
  const specifiers = (source: string) => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map(match => match[1]);
  const resolve = (from: string, specifier: string) => {
    const base = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? normalize(join(dirname(from), specifier)) : null;
    if (base === null) return null;
    const path = base.split(sep).join("/");
    return [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}/index.tsx`].find(candidate => CANONICAL.has(candidate) || candidate.startsWith("lib/server/") || known.includes(candidate)) ?? path;
  };
  const violations: string[] = [];
  for (const [file, source] of Object.entries(files)) {
    const server = file.startsWith("lib/server/") || file === "worker.ts" || file.startsWith("app/api/") || file === "app/sitemap.ts" || file === "app/robots.ts" || /^app\/(.*\/)?(page|layout|route|not-found)\.tsx?$/.test(file);
    const useClient = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use client["']/.test(source);
    for (const specifier of specifiers(source)) {
      const target = resolve(file, specifier);
      if (!target) continue;
      const canonical = CANONICAL.has(target);
      const serverOnly = target.startsWith("lib/server/");
      // 정본 JSON은 서버 모듈만 import한다. app의 서버 진입점은 lib/server를 통해서만 정본에 닿는다.
      if (canonical && !file.startsWith("lib/server/")) violations.push(`${file}: ${specifier} (정본 JSON은 lib/server만 import한다)`);
      // 브라우저로 나갈 수 있는 모듈은 서버 모듈을 import하지 못한다: components/, "use client" 모듈, lib/ 바로 아래 순수 모듈.
      const browserSide = file.startsWith("components/") || useClient || (file.startsWith("lib/") && !server);
      if (serverOnly && browserSide) violations.push(`${file}: ${specifier} (브라우저 쪽 모듈이 lib/server를 import한다)`);
    }
  }
  return violations;
}

function collect(path: string, files: Record<string, string>) {
  const absolute = join(root, path);
  if (statSync(absolute).isDirectory()) { for (const name of readdirSync(absolute)) collect(`${path}/${name}`, files); return; }
  if (/\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts")) files[relative(root, absolute).split(sep).join("/")] = readFileSync(absolute, "utf8");
}

test("browser-side modules import neither the canonical study JSON nor lib/server", () => {
  const files: Record<string, string> = {};
  for (const path of SCANNED) collect(path, files);
  assert.ok(Object.keys(files).length > 30);
  assert.deepEqual(findImportViolations(files), []);
});

test("the import check fails on a component, a client module or a pure lib module that reaches the canonical data", () => {
  const bad = (file: string, source: string) => findImportViolations({ [file]: source });
  assert.equal(bad("components/x.tsx", 'import data from "@/content/reading.json";').length, 1);
  assert.equal(bad("components/x.tsx", 'import data from "../content/prep.json";').length, 1);
  assert.equal(bad("components/x.tsx", 'import { getStudySource } from "@/lib/server/study-source";').length, 1);
  assert.equal(bad("components/x.tsx", 'const m = await import("@/lib/server/lesson-catalog");').length, 1);
  assert.equal(bad("app/widget.tsx", '"use client";\nimport { getStudySource } from "../lib/server/study-source";').length, 1);
  assert.equal(bad("lib/pure.ts", 'import { getPublicLesson } from "./server/lesson-catalog";').length, 1);
  assert.equal(bad("lib/pure.ts", 'import data from "../content/reading.json";').length, 1);
  assert.equal(bad("app/page.tsx", 'import data from "@/content/prep.json";').length, 1);
  assert.deepEqual(bad("lib/server/x.ts", 'import data from "../../content/reading.json";'), []);
  assert.deepEqual(bad("app/[[...slug]]/page.tsx", 'import { getPublicLesson } from "@/lib/server/lesson-catalog";'), []);
  assert.deepEqual(bad("components/x.tsx", 'import pages from "@/content/pages.json"; import { site } from "@/lib/content";'), []);
});
