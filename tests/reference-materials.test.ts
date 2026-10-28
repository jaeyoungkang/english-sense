import assert from "node:assert/strict";
import { test } from "node:test";
import pageData from "../content/pages.json";
import type { ContentPage, StageContent } from "../lib/content";
import { REFERENCE_IDS } from "../lib/reference-materials";
import { getPublicReferenceMaterials } from "../lib/server/reference-materials";

test("five reference materials project only their published sense stage and heading text", () => {
  const materials = getPublicReferenceMaterials();
  assert.deepEqual(materials.map((material) => material.id), REFERENCE_IDS);
  assert.deepEqual(materials.map((material) => material.sense), ["내 영역 안에 놓여 있다", "경계를 넘어 들어선다", "이미 거기 놓여 있다", "기준점에서 멀어진다", "기준점으로 다가온다"]);
  for (const material of materials) {
    const page = (pageData as ContentPage[]).find((page) => page.path === `${material.id}/`)!;
    const stage = page.parts.find((part): part is StageContent => part.kind === "stage")!;
    assert.equal(`${material.title}: ${material.sense}`, page.h1);
    assert.equal(material.description, stage.description.replace(/^버튼을 눌러 보십시오\.\s*/, ""));
    assert.ok(!material.description.includes("버튼을 눌러 보십시오."));
    assert.match(material.description, /점선|주어/);
    assert.equal(material.href, `/${material.id}/`);
    assert.deepEqual(material.zones, stage.zones);
    assert.deepEqual(Object.keys(material).sort(), ["id", "title", "sense", "description", "href", "zones", ...(material.id === "have" ? ["image"] : [])].sort());
    for (const zone of material.zones) {
      assert.ok(["k", "ex", "ctx", "lis"].every((key) => Object.hasOwn(zone, key)));
      assert.ok(Object.keys(zone).every((key) => ["k", "ex", "ctx", "lis", "subj", "item", "a", "b"].includes(key)));
    }
  }
});

test("reference payload excludes quiz answers, explanations, HTML and personal progress", () => {
  const wire = JSON.stringify(getPublicReferenceMaterials());
  for (const key of ["answer", "opts", "why", "feel", "fixes", "book", "questions", "html", "initialAttempt", "progress", "mastery", "completed"]) assert.ok(!wire.includes(`"${key}":`), key);
  assert.ok(!wire.includes("He had a white beard and a fancy uniform on."));
  assert.ok(!wire.includes("We have to get down to the third-class cabins before it's too late."));
});

test("image metadata uses the existing have image and textual sense remains available without it", () => {
  const materials = getPublicReferenceMaterials();
  const have = materials.find((material) => material.id === "have")!;
  assert.equal(have.image!.src, "/assets/learning/have-sense.webp");
  assert.match(have.image!.alt, /사람을 둘러싼 연두색 타원/);
  assert.equal(have.sense, "내 영역 안에 놓여 있다");
  assert.equal(have.zones.length, 7);
  assert.ok(materials.filter((material) => material.id !== "have").every((material) => !Object.hasOwn(material, "image")));
});

test("editing a returned public snapshot cannot change the published source or later reads", () => {
  const materials = getPublicReferenceMaterials();
  materials[0].zones[0].ex = "changed by consumer";
  materials[0].image!.alt = "changed by consumer";
  const fresh = getPublicReferenceMaterials();
  assert.equal(fresh[0].zones[0].ex, "I have a flashlight.");
  assert.notEqual(fresh[0].image!.alt, "changed by consumer");
});
