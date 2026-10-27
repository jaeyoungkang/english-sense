import assert from "node:assert/strict";
import { test } from "node:test";
import { getPublicLesson, getStoryLessonLinks } from "../lib/server/lesson-catalog";
import { getStudyListing, getStudySource } from "../lib/server/study-source";
import { clockLabel, pairStories } from "../lib/study-content";

const { reading } = getStudySource();
const chunks = (value: string) => value.split(/["'\\<>&\n`$]/).map(item => item.trim()).sort((a, b) => b.length - a.length);

/** The longest quote-free chunk the story's own public text does not contain (some explanations quote the story); the two short generic bases are matched whole. */
function secretOf(story: (typeof reading.stories)[number], value: string) {
  const publicText = [story.title, ...story.paragraphs.flat().map(piece => piece.text), ...story.questions.flatMap(question => [question.question, ...question.options])].join("\n");
  return chunks(value).find(chunk => chunk.length >= 10 && !publicText.includes(chunk)) ?? value;
}

/** What the page hands to the browser for a story: the public projection and the links, as the serialized props. */
async function pageProps(storyId: string) {
  return JSON.stringify({ lesson: await getPublicLesson(storyId), links: getStoryLessonLinks(storyId) });
}

test("the props of every story page carry no answer, explanation or basis, and the listing summary keeps only a summary of the stories", async () => {
  for (const story of reading.stories) {
    const props = await pageProps(story.id);
    for (const question of story.questions) {
      assert.ok(!props.includes(JSON.stringify(question.explain).slice(1, -1)), `${question.id} explain`);
      if (question.basis) assert.ok(!props.includes(JSON.stringify(question.basis).slice(1, -1)), `${question.id} basis`);
      for (const value of [question.explain, ...(question.basis ? [question.basis] : [])]) {
        const secret = secretOf(story, value);
        assert.ok(secret.length >= 6 && !props.includes(secret), `${question.id} ${secret}`);
      }
    }
    assert.ok(!/"(answer|explain|basis|answerIndex)"/.test(props), `${story.id} has no canonical key`);
    // The public part really is there, so the check above is not vacuous.
    assert.ok(props.includes(JSON.stringify(story.questions[0].question).slice(1, -1)));
  }
  const listed = JSON.stringify(getStudyListing().reading);
  assert.ok(!/"(questions|options|answer|explain|basis)"/.test(listed));
  for (const story of reading.stories) for (const question of story.questions) assert.ok(!listed.includes(secretOf(story, question.explain)));
  assert.deepEqual(getStudyListing().reading.stories.map(story => story.id), reading.stories.map(story => story.id));
  assert.deepEqual(getStudyListing().reading.stories.map(story => story.questionCount), reading.stories.map(story => story.questions.length));
});

test("a paired story links its unit and each expression question's card; a plain story has no links", () => {
  const paired = reading.stories.find(story => story.id === "prep-wonder-3")!;
  const links = getStoryLessonLinks(paired.id);
  assert.deepEqual(links.pair, { workTitle: "Wonder", unit: 3, href: "/prep/wonder/unit-3/" });
  for (const question of paired.questions.filter(item => item.kind === "expression")) {
    assert.ok(question.card);
    assert.equal(links.cards[question.card].href, `/prep/wonder/unit-3/#${question.card}`);
    assert.ok(links.cards[question.card].expression.length > 0);
  }
  assert.deepEqual(getStoryLessonLinks("green-umbrella"), { cards: {} });
  assert.throws(() => getStoryLessonLinks("wonder-unit-0"), /lesson_unavailable/);
  assert.throws(() => getStoryLessonLinks("__proto__"), /lesson_unavailable/);
});

test("the reading clock label and the paired-story lookup work on summaries as well", () => {
  assert.equal(clockLabel(161), "2:41");
  assert.equal(clockLabel(0), "0:00");
  assert.equal(clockLabel(-4), "0:00");
  assert.equal(clockLabel(180), "3:00");
  const summaries = getStudyListing().reading;
  assert.deepEqual(pairStories(summaries, "wonder", 3).map(story => story.id), ["prep-wonder-3"]);
});
