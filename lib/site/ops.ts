/**
 * Edit operations.
 *
 * This is the contract between "something that decided on a change" and "the
 * document". Today the keyword interpreter produces these ops. Tomorrow
 * `/api/edit` and the realtime voice tool call will produce exactly the same
 * shape, and nothing downstream has to change.
 *
 * `applyOps` is pure and total: it never throws and never mutates its input.
 * Anything it cannot understand comes back in `rejected` so the caller can
 * show it, log it, or feed it back to the model for a retry.
 */

import {
  createSection,
  findSection,
  isHexColor,
  isSectionType,
  sectionDefaults,
  type Section,
  type SectionPropsMap,
  type SectionType,
  type SiteDocument,
  type Theme,
} from "./schema.ts";

export type EditOp =
  | { op: "set_meta"; patch: Partial<SiteDocument["meta"]> }
  | { op: "set_theme"; patch: Partial<Theme> }
  | { op: "add_section"; type: SectionType; props?: Record<string, unknown>; index?: number }
  | { op: "remove_section"; id: string }
  | { op: "move_section"; id: string; index: number }
  | { op: "update_section"; id: string; patch: Record<string, unknown> };

export type RejectedOp = { op: EditOp; reason: string };

export type ApplyResult = {
  document: SiteDocument;
  applied: EditOp[];
  rejected: RejectedOp[];
  /** Human-readable lines suitable for the build activity log. */
  changes: string[];
};

const themeEnums: Record<string, readonly string[]> = {
  font: ["editorial", "modern", "geometric"],
  radius: ["sharp", "soft", "round"],
  density: ["compact", "comfortable", "spacious"],
};

/**
 * Drop keys that do not exist on the section type's defaults. Models
 * confidently invent properties; without this they would accumulate in the
 * document and never render.
 */
function sanitizeProps<T extends SectionType>(
  type: T,
  patch: Record<string, unknown>,
): { props: Partial<SectionPropsMap[T]>; dropped: string[] } {
  const allowed = sectionDefaults[type] as Record<string, unknown>;
  const props: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key in allowed && value !== undefined) props[key] = value;
    else dropped.push(key);
  }
  return { props: props as Partial<SectionPropsMap[T]>, dropped };
}

function sanitizeTheme(patch: Partial<Theme>): { theme: Partial<Theme>; dropped: string[] } {
  const theme: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === "background" || key === "foreground" || key === "accent") {
      if (isHexColor(value)) theme[key] = value;
      else dropped.push(key);
    } else if (key in themeEnums) {
      if (themeEnums[key].includes(value as string)) theme[key] = value;
      else dropped.push(key);
    } else {
      dropped.push(key);
    }
  }
  return { theme: theme as Partial<Theme>, dropped };
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

export function applyOps(document: SiteDocument, ops: readonly EditOp[]): ApplyResult {
  let next: SiteDocument = structuredClone(document);
  const applied: EditOp[] = [];
  const rejected: RejectedOp[] = [];
  const changes: string[] = [];

  for (const op of ops ?? []) {
    if (typeof op?.op !== "string") {
      rejected.push({ op, reason: "Operation is missing an `op` field." });
      continue;
    }

    switch (op.op) {
      case "set_meta": {
        const patch: Partial<SiteDocument["meta"]> = {};
        if (typeof op.patch?.name === "string" && op.patch.name.trim()) {
          patch.name = op.patch.name.trim();
        }
        if (typeof op.patch?.description === "string") {
          patch.description = op.patch.description.trim();
        }
        if (Object.keys(patch).length === 0) {
          rejected.push({ op, reason: "No usable meta fields." });
          break;
        }
        next.meta = { ...next.meta, ...patch };
        applied.push(op);
        if (patch.name) changes.push(`Renamed the site to ${patch.name}`);
        break;
      }

      case "set_theme": {
        const { theme, dropped } = sanitizeTheme(op.patch ?? {});
        if (Object.keys(theme).length === 0) {
          rejected.push({ op, reason: `No valid theme fields (ignored: ${dropped.join(", ") || "none"}).` });
          break;
        }
        next.theme = { ...next.theme, ...theme };
        applied.push(op);
        changes.push(`Updated ${Object.keys(theme).join(", ")}`);
        break;
      }

      case "add_section": {
        if (!isSectionType(op.type)) {
          rejected.push({ op, reason: `Unknown section type "${String(op.type)}".` });
          break;
        }
        const { props } = sanitizeProps(op.type, op.props ?? {});
        const section = createSection(op.type, next.sections, props);
        const at = op.index === undefined ? next.sections.length : clampIndex(op.index, next.sections.length);
        next.sections = [
          ...next.sections.slice(0, at),
          section as Section,
          ...next.sections.slice(at),
        ];
        applied.push(op);
        changes.push(`Added a ${op.type} section`);
        break;
      }

      case "remove_section": {
        const existing = findSection(next, op.id);
        if (!existing) {
          rejected.push({ op, reason: `No section with id "${op.id}".` });
          break;
        }
        next.sections = next.sections.filter((section) => section.id !== op.id);
        applied.push(op);
        changes.push(`Removed the ${existing.type} section`);
        break;
      }

      case "move_section": {
        const from = next.sections.findIndex((section) => section.id === op.id);
        if (from === -1) {
          rejected.push({ op, reason: `No section with id "${op.id}".` });
          break;
        }
        const without = next.sections.filter((_, index) => index !== from);
        const to = clampIndex(op.index, without.length);
        next.sections = [...without.slice(0, to), next.sections[from], ...without.slice(to)];
        applied.push(op);
        changes.push(`Moved ${next.sections[to].type} to position ${to + 1}`);
        break;
      }

      case "update_section": {
        const existing = findSection(next, op.id);
        if (!existing) {
          rejected.push({ op, reason: `No section with id "${op.id}".` });
          break;
        }
        const { props, dropped } = sanitizeProps(existing.type, op.patch ?? {});
        if (Object.keys(props).length === 0) {
          rejected.push({
            op,
            reason: `No writable properties on a ${existing.type} section (ignored: ${dropped.join(", ") || "none"}).`,
          });
          break;
        }
        next.sections = next.sections.map((section) =>
          section.id === op.id
            ? ({ ...section, props: { ...section.props, ...props } } as Section)
            : section,
        );
        applied.push(op);
        changes.push(`Edited ${Object.keys(props).join(", ")} on ${existing.type}`);
        break;
      }

      default: {
        rejected.push({ op, reason: `Unsupported operation "${(op as EditOp).op}".` });
      }
    }
  }

  return { document: next, applied, rejected, changes };
}

/**
 * Convenience for the UI: what a section is called in conversation.
 */
export function describeSection(section: Section): string {
  switch (section.type) {
    case "hero":
      return section.props.headline || "Hero";
    case "services":
      return `${section.props.items.length} services`;
    case "gallery":
      return `${section.props.items.length} gallery tiles`;
    default:
      return section.type;
  }
}
