/**
 * Deterministic keyword interpreter.
 *
 * This is NOT AI. It is a stand-in that produces exactly the same `EditOp[]`
 * that `/api/edit` will return once a model is connected, so the rest of the
 * app can be built and tested against the real contract today.
 *
 * When the model lands, this file stays: it becomes the offline fallback for
 * when the API is unreachable, rate-limited, or the user has no key.
 */

import type { EditOp } from "./ops.ts";
import type { SectionType, SiteDocument } from "./schema.ts";

export type Interpretation = {
  ops: EditOp[];
  /** What Nova says back. */
  reply: string;
  /** True when nothing in the prompt was understood. */
  unmatched: boolean;
};

const palettes: { match: RegExp; accent: string }[] = [
  { match: /\b(blue|navy|cobalt)\b/, accent: "#315ee8" },
  { match: /\b(green|lime|emerald)\b/, accent: "#b9ef45" },
  { match: /\b(orange|rust|terracotta)\b/, accent: "#d76131" },
  { match: /\b(purple|violet|lilac)\b/, accent: "#8759e8" },
  { match: /\b(red|burgundy|crimson)\b/, accent: "#9c3042" },
  { match: /\b(yellow|gold|amber)\b/, accent: "#e0a516" },
  { match: /\b(pink|rose|magenta)\b/, accent: "#d6558e" },
  { match: /\b(teal|cyan|aqua)\b/, accent: "#1f9c94" },
];

const sectionKeywords: { type: SectionType; match: RegExp; noun: string }[] = [
  { type: "announcement", match: /\b(announcement|top bar|utility bar)\b/, noun: "announcement bar" },
  { type: "nav", match: /\b(nav|navigation|menu bar)\b/, noun: "navigation" },
  { type: "services", match: /\b(services?|offerings?|what we do)\b/, noun: "services section" },
  { type: "gallery", match: /\b(gallery|portfolio|project grid|photos?)\b/, noun: "gallery" },
  { type: "stats", match: /\b(stats?|numbers|metrics)\b/, noun: "stats row" },
  { type: "process", match: /\b(process|how (?:it|we) works?|steps)\b/, noun: "process section" },
  { type: "testimonial", match: /\b(testimonials?|reviews?|client quote)\b/, noun: "testimonial" },
  { type: "cta", match: /\b(call to action|cta)\b/, noun: "call-to-action band" },
  { type: "contact", match: /\b(contact|booking|inquiry|enquiry|form)\b/, noun: "contact form" },
  { type: "footer", match: /\b(footer)\b/, noun: "footer" },
];

const ADD = /\b(add|include|insert|put in|give me|need|want|create|append)\b/;
const REMOVE = /\b(remove|delete|drop|hide|get rid of|take out|lose the)\b/;

/** Section types that always belong at a fixed end of the page. */
const pinnedLast: SectionType[] = ["footer"];

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? "an" : "a";
}

type Extraction = { value: string; span: [number, number] } | undefined;

function extract(text: string, expression: RegExp): Extraction {
  const match = text.match(expression);
  if (!match || match.index === undefined || !match[1]) return undefined;
  const value = match[1].trim().replace(/["“”]/g, "").replace(/[.!]$/, "");
  if (!value) return undefined;
  return { value, span: [match.index, match.index + match[0].length] };
}

function findByType(document: SiteDocument, type: SectionType) {
  return document.sections.find((section) => section.type === type);
}

/**
 * Where a newly added section should land, given the section types the page
 * will have once the ops queued so far are applied.
 */
function insertionIndex(type: SectionType, projected: SectionType[]): number {
  if (type === "announcement") return 0;
  if (type === "nav") return projected.includes("announcement") ? 1 : 0;
  if (pinnedLast.includes(type)) return projected.length;
  const footerAt = projected.findIndex((entry) => pinnedLast.includes(entry));
  return footerAt === -1 ? projected.length : footerAt;
}

export function interpret(document: SiteDocument, prompt: string): Interpretation {
  const text = prompt.trim();
  const ops: EditOp[] = [];
  const notes: string[] = [];

  /* ------------------------------------------------------- copy first */

  // Copy the user dictates ("headline to Architecture for modern life") must
  // not also be scanned for style keywords, or "modern" in their own sentence
  // silently changes the typeface. Extract it, then blank it out.
  const hero = findByType(document, "hero");
  const headline = extract(text, /(?:headline|title|h1)(?:\s+to|\s*:)?\s+["“]?([^"”]+)["”]?/i);
  const subhead = extract(text, /(?:subhead|subtitle|tagline)(?:\s+to|\s*:)?\s+["“]?([^"”]+)["”]?/i);
  const name = extract(
    text,
    /(?:business|studio|company|brand|site)(?:\s+name)?(?:\s+to|\s+is|\s*:)?\s+["“]?([^"”]+)["”]?/i,
  );

  let residual = text;
  for (const found of [headline, subhead, name]) {
    if (!found) continue;
    residual =
      residual.slice(0, found.span[0]) + " ".repeat(found.span[1] - found.span[0]) + residual.slice(found.span[1]);
  }
  const lower = residual.toLowerCase();

  if (headline && headline.value.length < 90 && hero) {
    ops.push({ op: "update_section", id: hero.id, patch: { headline: headline.value } });
    notes.push("rewrote the headline");
  }
  if (subhead && hero) {
    ops.push({ op: "update_section", id: hero.id, patch: { subhead: subhead.value } });
    notes.push("rewrote the subhead");
  }
  if (name && name.value.length < 45 && !/\b(website|site|dark|light|modern)\b/i.test(name.value)) {
    ops.push({ op: "set_meta", patch: { name: name.value } });
    notes.push(`renamed the site to ${name.value}`);
  }

  /* ---------------------------------------------------------- theme */

  if (/\b(dark|black|night|moody)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { background: "#151a17", foreground: "#f2eee4" } });
    notes.push("switched to a dark palette");
  } else if (/\b(light|cream|sand|bright|pale)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { background: "#ede6d7", foreground: "#273329" } });
    notes.push("switched to a light palette");
  }

  const hex = residual.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hex) {
    ops.push({ op: "set_theme", patch: { accent: hex[0] } });
    notes.push(`set the accent to ${hex[0]}`);
  } else {
    const palette = palettes.find((entry) => entry.match.test(lower));
    if (palette) {
      ops.push({ op: "set_theme", patch: { accent: palette.accent } });
      notes.push("updated the accent colour");
    }
  }

  if (/\b(modern|clean|minimal|sans[- ]?serif)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { font: "modern" } });
    notes.push("moved to a modern typeface");
  } else if (/\b(editorial|luxury|serif|elegant|classic)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { font: "editorial" } });
    notes.push("moved to an editorial typeface");
  } else if (/\b(geometric|futura|bauhaus)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { font: "geometric" } });
    notes.push("moved to a geometric typeface");
  }

  if (/\b(rounded|soft corners|friendly)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { radius: "round" } });
    notes.push("rounded the corners");
  } else if (/\b(sharp|square corners|hard edges)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { radius: "sharp" } });
    notes.push("squared the corners");
  }

  if (/\b(spacious|airy|roomy|more space|breathing room)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { density: "spacious" } });
    notes.push("opened up the spacing");
  } else if (/\b(compact|tight|dense|condensed)\b/.test(lower)) {
    ops.push({ op: "set_theme", patch: { density: "compact" } });
    notes.push("tightened the spacing");
  }

  /* -------------------------------------------------- section changes */

  const wantsAdd = ADD.test(lower);
  const wantsRemove = REMOVE.test(lower);
  const wantsMove = /\b(move|reorder|put the|bring the)\b/.test(lower);

  // Match sections in the order the user mentioned them, not the order of
  // this file's lookup table.
  const mentioned = sectionKeywords
    .map((keyword) => ({ keyword, at: lower.search(keyword.match) }))
    .filter((entry) => entry.at !== -1)
    .sort((a, b) => a.at - b.at);

  const projected = document.sections.map((section) => section.type);

  for (const { keyword } of mentioned) {
    const existing = findByType(document, keyword.type);

    if (wantsMove && existing) continue; // handled below
    if (wantsRemove && existing) {
      ops.push({ op: "remove_section", id: existing.id });
      notes.push(`removed the ${keyword.noun}`);
      const at = projected.indexOf(keyword.type);
      if (at !== -1) projected.splice(at, 1);
      continue;
    }
    if (wantsAdd && !existing && !projected.includes(keyword.type)) {
      const index = insertionIndex(keyword.type, projected);
      ops.push({ op: "add_section", type: keyword.type, index });
      projected.splice(index, 0, keyword.type);
      notes.push(`added ${article(keyword.noun)} ${keyword.noun}`);
      continue;
    }
    if (wantsAdd && existing) {
      notes.push(`kept the existing ${keyword.noun}`);
    }
  }

  /* --------------------------------------------------------- ordering */

  if (wantsMove && mentioned.length > 0) {
    const target = mentioned[0].keyword;
    const existing = findByType(document, target.type);
    if (existing && /\b(top|first|start|beginning)\b/.test(lower)) {
      ops.push({ op: "move_section", id: existing.id, index: 0 });
      notes.push(`moved the ${target.noun} to the top`);
    } else if (existing && /\b(bottom|end|last)\b/.test(lower)) {
      ops.push({ op: "move_section", id: existing.id, index: document.sections.length });
      notes.push(`moved the ${target.noun} to the bottom`);
    }
  }

  if (ops.length === 0) {
    return {
      ops,
      unmatched: true,
      reply:
        "I can't do that one yet. Right now I understand colours, typography, spacing, headline and name changes, and adding, removing or reordering sections.",
    };
  }

  return { ops, unmatched: false, reply: `Done — I ${joinList(notes)}.` };
}

function joinList(items: string[]): string {
  const unique = [...new Set(items)];
  if (unique.length <= 1) return unique[0] ?? "made no changes";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}
