/**
 * Run with:  node --experimental-strip-types --test tests/site-model.test.ts
 *
 * These tests deliberately need no dev server, no bundler, and no network.
 * That matters: a coding agent working on this repo can verify its own changes
 * in about a second, which is the difference between it converging and it
 * guessing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOps, type EditOp } from "../lib/site/ops.ts";
import { renderSite } from "../lib/site/render.ts";
import { interpret } from "../lib/site/interpret.ts";
import {
  createSection,
  createStarterDocument,
  sectionTypes,
  validateDocument,
} from "../lib/site/schema.ts";

/* ------------------------------------------------------------- schema */

test("the starter document is valid", () => {
  assert.deepEqual(validateDocument(createStarterDocument()), []);
});

test("validation catches duplicate section ids", () => {
  const document = createStarterDocument();
  document.sections.push({ ...document.sections[0] });
  const issues = validateDocument(document);
  assert.ok(issues.some((issue) => issue.message.includes("Duplicate")));
});

test("validation rejects a non-hex accent", () => {
  const document = createStarterDocument();
  document.theme.accent = "burnt orange";
  const issues = validateDocument(document);
  assert.ok(issues.some((issue) => issue.path === "theme.accent"));
});

test("section ids stay unique as duplicates are added", () => {
  const document = createStarterDocument();
  const result = applyOps(document, [
    { op: "add_section", type: "services" },
    { op: "add_section", type: "services" },
    { op: "add_section", type: "services" },
  ]);
  const ids = result.document.sections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("services") && ids.includes("services-2") && ids.includes("services-3"));
});

/* ---------------------------------------------------------------- ops */

test("applyOps never mutates the input document", () => {
  const document = createStarterDocument();
  const snapshot = JSON.stringify(document);
  applyOps(document, [
    { op: "set_theme", patch: { accent: "#315ee8" } },
    { op: "add_section", type: "contact" },
  ]);
  assert.equal(JSON.stringify(document), snapshot);
});

test("invalid ops are rejected rather than thrown", () => {
  const document = createStarterDocument();
  const ops = [
    { op: "add_section", type: "pricing_table" },
    { op: "remove_section", id: "does-not-exist" },
    { op: "set_theme", patch: { accent: "not-a-colour" } },
    { op: "teleport_section", id: "hero" },
    null,
  ] as unknown as EditOp[];

  const result = applyOps(document, ops);
  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 5);
  assert.deepEqual(result.document, document);
});

test("update_section drops properties that do not exist on the type", () => {
  const document = createStarterDocument();
  const result = applyOps(document, [
    { op: "update_section", id: "hero", patch: { headline: "New direction", sparkleLevel: 11 } },
  ]);
  const hero = result.document.sections.find((section) => section.id === "hero");
  assert.equal((hero?.props as { headline: string }).headline, "New direction");
  assert.ok(!("sparkleLevel" in (hero?.props ?? {})));
});

test("a partially valid batch applies the good ops and reports the bad", () => {
  const document = createStarterDocument();
  const result = applyOps(document, [
    { op: "set_theme", patch: { accent: "#315ee8" } },
    { op: "remove_section", id: "ghost" },
  ] as EditOp[]);
  assert.equal(result.document.theme.accent, "#315ee8");
  assert.equal(result.applied.length, 1);
  assert.equal(result.rejected.length, 1);
});

test("sections can be reordered", () => {
  const document = createStarterDocument();
  const added = applyOps(document, [{ op: "add_section", type: "contact" }]).document;
  const moved = applyOps(added, [{ op: "move_section", id: "contact", index: 0 }]).document;
  assert.equal(moved.sections[0].id, "contact");
  assert.equal(moved.sections.length, added.sections.length);
});

/* ------------------------------------------------------------- render */

test("every section type renders without throwing", () => {
  for (const type of sectionTypes) {
    const document = createStarterDocument();
    document.sections = [createSection(type, [])];
    const html = renderSite(document);
    assert.ok(html.startsWith("<!doctype html>"), `${type} produced no document`);
    assert.ok(html.length > 200, `${type} rendered suspiciously little`);
  }
});

test("the iframe srcDoc render sets its own base so in-page anchors don't navigate to the host page", () => {
  // The live preview renders via <iframe srcDoc>, whose document address is
  // about:srcdoc but which otherwise inherits the parent page's base URL for
  // resolving relative hrefs. Without an explicit <base>, a fragment-only
  // link like href="#hero" resolves against the parent's URL instead of the
  // iframe's own, so the browser treats it as a real cross-document
  // navigation rather than an in-page scroll — sending the sandboxed iframe
  // (no allow-same-origin) off to load the host app inside itself.
  const html = renderSite(createStarterDocument(), { base: "about:srcdoc" });
  const headEnd = html.indexOf("</head>");
  assert.ok(headEnd !== -1);
  assert.ok(html.slice(0, headEnd).includes('<base href="about:srcdoc">'));
});

test("a standalone render (published output, opened preview) has no base override", () => {
  // The opposite bug: forcing about:srcdoc on a page served at its own real
  // URL (published output, or the blob: tab from "Open") would break every
  // in-page link there instead, since a real document's base must match its
  // own address. Default output must have no <base> tag at all.
  const html = renderSite(createStarterDocument());
  assert.ok(!html.includes("<base"));
});

test("user copy cannot inject markup", () => {
  const document = createStarterDocument();
  const attack = '</h1><script>alert("xss")</script>';
  const edited = applyOps(document, [
    { op: "set_meta", patch: { name: attack } },
    { op: "update_section", id: "hero", patch: { headline: attack } },
  ]).document;

  const html = renderSite(edited);
  assert.ok(!html.includes("<script>alert"), "raw script tag reached the output");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("javascript: hrefs are stripped", () => {
  const document = createStarterDocument();
  const edited = applyOps(document, [
    {
      op: "update_section",
      id: "hero",
      patch: { primaryCta: { label: "Click", href: "javascript:alert(1)" } },
    },
  ]).document;
  assert.ok(!renderSite(edited).includes("javascript:"));
});

test("theme values reach the rendered CSS", () => {
  const document = createStarterDocument();
  const edited = applyOps(document, [
    { op: "set_theme", patch: { accent: "#315ee8", background: "#151a17" } },
  ]).document;
  const html = renderSite(edited);
  assert.ok(html.includes("--accent:#315ee8"));
  assert.ok(html.includes("--bg:#151a17"));
});

/* ---------------------------------------------------------- interpret */

test("interpretation feeds straight into applyOps", () => {
  const document = createStarterDocument();
  const { ops, unmatched } = interpret(document, "make it dark with a lime accent");
  assert.equal(unmatched, false);
  const result = applyOps(document, ops);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.document.theme.background, "#151a17");
  assert.equal(result.document.theme.accent, "#b9ef45");
});

test("adding a section by name works end to end", () => {
  const document = createStarterDocument();
  const { ops } = interpret(document, "add a services section and a contact form");
  const result = applyOps(document, ops);
  const types = result.document.sections.map((section) => section.type);
  assert.ok(types.includes("services"));
  assert.ok(types.includes("contact"));
  assert.equal(result.rejected.length, 0);
});

test("removing a section by name works end to end", () => {
  let document = createStarterDocument();
  document = applyOps(document, [{ op: "add_section", type: "gallery" }]).document;
  const { ops } = interpret(document, "remove the gallery");
  const result = applyOps(document, ops);
  assert.ok(!result.document.sections.some((section) => section.type === "gallery"));
});

test("asking twice does not duplicate a section", () => {
  let document = createStarterDocument();
  document = applyOps(document, interpret(document, "add a contact form").ops).document;
  document = applyOps(document, interpret(document, "add a contact form").ops).document;
  const contacts = document.sections.filter((section) => section.type === "contact");
  assert.equal(contacts.length, 1);
});

test("an unrecognised prompt reports itself instead of silently doing nothing", () => {
  const document = createStarterDocument();
  const result = interpret(document, "connect this to my Shopify inventory");
  assert.equal(result.unmatched, true);
  assert.equal(result.ops.length, 0);
});

/* --------------------------------------------- interpreter regressions */

test("dictated copy is not scanned for style keywords", () => {
  // "modern" inside the user's own headline must not change the typeface.
  const document = createStarterDocument();
  const { ops } = interpret(document, "change the headline to Architecture for modern life");
  const result = applyOps(document, ops);
  assert.equal(result.document.theme.font, "editorial");
  const hero = result.document.sections.find((section) => section.id === "hero");
  assert.equal((hero?.props as { headline: string }).headline, "Architecture for modern life");
});

test("a brand name containing a stop-word is still accepted", () => {
  // "Northlight" contains "light" — it must not be swallowed by the guard.
  const document = createStarterDocument();
  const { ops } = interpret(document, "set the business name to Northlight");
  const result = applyOps(document, ops);
  assert.equal(result.document.meta.name, "Northlight");
});

test("new sections land in a sensible position", () => {
  const document = createStarterDocument();
  const { ops } = interpret(
    document,
    "add an announcement bar, a gallery, a contact form and a footer",
  );
  const types = applyOps(document, ops).document.sections.map((section) => section.type);
  assert.equal(types[0], "announcement");
  assert.equal(types[1], "nav");
  assert.equal(types.at(-1), "footer");
  assert.ok(types.indexOf("gallery") > types.indexOf("hero"));
});

test("sections are added in the order the user listed them", () => {
  const document = createStarterDocument();
  const { ops } = interpret(document, "add a gallery, a process section and stats");
  const types = applyOps(document, ops).document.sections.map((section) => section.type);
  assert.ok(types.indexOf("gallery") < types.indexOf("process"));
  assert.ok(types.indexOf("process") < types.indexOf("stats"));
});

test("a hex colour in the prompt is honoured", () => {
  const document = createStarterDocument();
  const { ops } = interpret(document, "use #ff5722 as the accent");
  const result = applyOps(document, ops);
  assert.equal(result.document.theme.accent, "#ff5722");
});
