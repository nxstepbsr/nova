/**
 * Browser-only session persistence for the studio UI (document, version
 * history, conversation). Deliberately kept out of lib/site/, which must
 * stay portable across server, edge, and node --test environments — this
 * file touches localStorage and only ever runs in the client component.
 */

import { validateDocument, type SiteDocument } from "./site/schema";

export type Message = { from: "ai" | "you"; text: string };

export type CanvasState = {
  version: 1;
  site: SiteDocument;
  versions: SiteDocument[];
  versionIndex: number;
  messages: Message[];
};

const STORAGE_KEY = "canvas:state";

export function saveCanvasState(state: CanvasState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private browsing, quota exceeded) — skip silently.
  }
}

export function loadCanvasState(): CanvasState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CanvasState>;
    if (parsed.version !== 1) return null;
    if (!Array.isArray(parsed.versions) || parsed.versions.length === 0) return null;
    if (typeof parsed.versionIndex !== "number") return null;
    if (!Array.isArray(parsed.messages)) return null;

    for (const document of parsed.versions) {
      if (validateDocument(document).length > 0) return null;
    }

    const site = parsed.versions[parsed.versionIndex];
    if (!site) return null;

    return {
      version: 1,
      site,
      versions: parsed.versions as SiteDocument[],
      versionIndex: parsed.versionIndex,
      messages: parsed.messages as Message[],
    };
  } catch {
    return null;
  }
}
