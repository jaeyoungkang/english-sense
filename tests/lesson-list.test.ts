import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonListDialog } from "../components/lesson-list-dialog";
import { lessonListing } from "../lib/lesson-list";
import { LESSONS } from "../lib/lesson-registry";
import { getLessonListing, getStudyListing, getStudySource } from "../lib/server/study-source";

const { reading, prep } = getStudySource();

test("the lesson list carries the titles and existing addresses of the 15 stories and 13 units, and nothing else", () => {
  const listing = getLessonListing();
  assert.deepEqual(listing, lessonListing(getStudyListing()));
  assert.equal(listing.stories.length, 15);
  assert.equal(listing.works.reduce((sum, work) => sum + work.units.length, 0), 13);
  const addresses = LESSONS.filter(entry => entry.kind !== "scene").map(entry => entry.path);
  assert.deepEqual([...listing.stories.map(story => story.href), ...listing.works.flatMap(work => work.units.map(unit => unit.href))], addresses);
  assert.deepEqual(listing.works.map(work => work.href), prep.works.map(work => `/prep/${work.id}/`));
  assert.deepEqual(listing.stories.map(story => story.title), reading.stories.map(story => story.title));
  assert.deepEqual(listing.stories.map(story => story.draft), reading.stories.map(story => story.draft));
  const text = JSON.stringify(listing);
  // No question ids (about 350 in the registry), card ids, answers or explanations reach the home page's props.
  assert.ok(!/-content-\d|-sense-\d|-expression-\d|"answers?"|"explain"|"basis"|"cards"|"questions?"/.test(text));
  for (const work of prep.works) for (const unit of work.units) for (const card of unit.cards.slice(0, 3)) assert.ok(!text.includes(card.id), card.id);
  for (const story of reading.stories) for (const question of story.questions) assert.ok(!text.includes(question.id), question.id);
});

test("the listing summary of the book and movie units has no cards: counts only", () => {
  const listed = getStudyListing().prep;
  const text = JSON.stringify(listed);
  assert.ok(!/"cards"|"answers"|"drill"|"example"/.test(text));
  assert.deepEqual(listed.works.map(work => work.cardCount), prep.works.map(work => work.units.reduce((sum, unit) => sum + unit.cards.length, 0)));
  assert.deepEqual(listed.works.flatMap(work => work.units.map(unit => unit.cardCount)), prep.works.flatMap(work => work.units.map(unit => unit.cards.length)));
});

test("the list window draws a link for every story and unit and the two full lists", () => {
  const html = renderToStaticMarkup(createElement(LessonListDialog, { listing: getLessonListing() }));
  for (const entry of LESSONS.filter(item => item.kind !== "scene")) assert.ok(html.includes(`href="${entry.path}"`), entry.path);
  assert.ok(html.includes('href="/reading/"') && html.includes('href="/prep/"'));
  assert.equal((html.match(/draft-tag/g) ?? []).length, reading.stories.filter(story => story.draft).length);
  assert.match(html, /이야기 읽기 · 15편/);
  assert.match(html, /유닛 13개/);
});
