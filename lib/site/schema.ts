/**
 * Canvas site document model.
 *
 * Zero runtime dependencies and no framework imports. This file must stay
 * portable: it runs identically in a Cloudflare Worker, a Next server action,
 * a Vercel edge function, the browser, and a plain `node --test` process.
 */

export const DOCUMENT_VERSION = 1 as const;

/* ------------------------------------------------------------------ theme */

export type FontDirection = "editorial" | "modern" | "geometric";
export type Radius = "sharp" | "soft" | "round";
export type Density = "compact" | "comfortable" | "spacious";

export type Theme = {
  background: string;
  foreground: string;
  accent: string;
  font: FontDirection;
  radius: Radius;
  density: Density;
};

export const defaultTheme: Theme = {
  background: "#ede6d7",
  foreground: "#273329",
  accent: "#b45132",
  font: "editorial",
  radius: "sharp",
  density: "comfortable",
};

/* --------------------------------------------------------------- sections */

export type Link = { label: string; href: string };

export type AnnouncementProps = { text: string; link: Link | null };
export type NavProps = { links: Link[]; sticky: boolean; showBrand: boolean };
export type HeroProps = {
  eyebrow: string;
  headline: string;
  subhead: string;
  primaryCta: Link | null;
  secondaryCta: Link | null;
  visual: "architectural" | "gradient" | "none";
  layout: "split" | "centered";
};
export type ServicesProps = {
  label: string;
  heading: string;
  items: { title: string; body: string }[];
  columns: 2 | 3 | 4;
};
export type GalleryProps = {
  label: string;
  heading: string;
  items: { caption: string; tone: "light" | "mid" | "dark" | "accent" }[];
  columns: 2 | 3 | 4;
};
export type StatsProps = { items: { value: string; label: string }[] };
export type ProcessProps = {
  label: string;
  heading: string;
  steps: { title: string; body: string }[];
};
export type TestimonialProps = { quote: string; attribution: string; role: string };
export type CtaProps = { heading: string; body: string; button: Link };
export type ContactProps = {
  label: string;
  heading: string;
  fields: { name: string; label: string; type: "text" | "email" | "tel" | "textarea" }[];
  buttonLabel: string;
};
export type FooterProps = {
  columns: { title: string; links: Link[] }[];
  note: string;
};

export type SectionPropsMap = {
  announcement: AnnouncementProps;
  nav: NavProps;
  hero: HeroProps;
  services: ServicesProps;
  gallery: GalleryProps;
  stats: StatsProps;
  process: ProcessProps;
  testimonial: TestimonialProps;
  cta: CtaProps;
  contact: ContactProps;
  footer: FooterProps;
};

export type SectionType = keyof SectionPropsMap;

export type Section<T extends SectionType = SectionType> = {
  [K in SectionType]: { id: string; type: K; props: SectionPropsMap[K] };
}[T];

export type SiteDocument = {
  version: typeof DOCUMENT_VERSION;
  meta: { name: string; description: string };
  theme: Theme;
  sections: Section[];
};

/* ------------------------------------------------------- section defaults */

/**
 * Every section type must appear here. `applyOps` uses these as both the
 * seed for `add_section` and the allow-list of writable keys for
 * `update_section`, so a model that invents a property gets it dropped
 * rather than silently corrupting the document.
 */
export const sectionDefaults: { [K in SectionType]: SectionPropsMap[K] } = {
  announcement: {
    text: "Now taking projects for next season.",
    link: { label: "Get in touch", href: "#contact" },
  },
  nav: {
    links: [
      { label: "Work", href: "#hero" },
      { label: "Contact", href: "#contact" },
    ],
    sticky: true,
    showBrand: true,
  },
  hero: {
    eyebrow: "ARCHITECTURE · INTERIORS · OBJECTS",
    headline: "Quiet spaces. Lasting impact.",
    subhead:
      "We design thoughtful environments shaped by light, material, and the way people actually live.",
    primaryCta: { label: "Explore the studio", href: "#services" },
    secondaryCta: null,
    visual: "architectural",
    layout: "split",
  },
  services: {
    label: "WHAT WE DO",
    heading: "",
    items: [
      { title: "Architecture", body: "Grounded, enduring spaces designed around real life." },
      { title: "Interiors", body: "Materials, light, and details working in quiet harmony." },
      { title: "Objects", body: "Useful pieces with a strong sense of place." },
    ],
    columns: 3,
  },
  gallery: {
    label: "SELECTED WORK",
    heading: "",
    items: [
      { caption: "Ridgeline House", tone: "mid" },
      { caption: "Harbour Studio", tone: "dark" },
      { caption: "Field Pavilion", tone: "accent" },
    ],
    columns: 3,
  },
  stats: {
    items: [
      { value: "24", label: "Projects delivered" },
      { value: "11", label: "Years in practice" },
      { value: "4", label: "Design awards" },
    ],
  },
  process: {
    label: "HOW WE WORK",
    heading: "",
    steps: [
      { title: "Listen", body: "We start with how you actually use the space." },
      { title: "Draw", body: "Options in plan and section, reviewed together." },
      { title: "Build", body: "We stay on site until the detail is right." },
    ],
  },
  testimonial: {
    quote: "They understood the site better than we did, and the result proves it.",
    attribution: "Marta Feld",
    role: "Ridgeline House",
  },
  cta: {
    heading: "Let's make something lasting.",
    body: "Tell us about the project and we'll come back within two days.",
    button: { label: "Start a project", href: "#contact" },
  },
  contact: {
    label: "START A PROJECT",
    heading: "Let's make something lasting.",
    fields: [
      { name: "name", label: "Your name", type: "text" },
      { name: "email", label: "Email address", type: "email" },
      { name: "details", label: "Tell us about the project", type: "textarea" },
    ],
    buttonLabel: "Send inquiry",
  },
  footer: {
    columns: [
      {
        title: "Studio",
        links: [
          { label: "Work", href: "#hero" },
          { label: "Contact", href: "#contact" },
        ],
      },
    ],
    note: "© Atelier North",
  },
};

export const sectionTypes = Object.keys(sectionDefaults) as SectionType[];

export function isSectionType(value: unknown): value is SectionType {
  return typeof value === "string" && sectionTypes.includes(value as SectionType);
}

/* --------------------------------------------------------------- utilities */

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Readable, stable ids (`hero`, `services`, `services-2`). The model refers to
 * sections by id in edit ops, so ids that describe themselves are much easier
 * to get right than opaque uuids.
 */
export function createSectionId(type: SectionType, existing: readonly Section[]): string {
  const taken = new Set(existing.map((section) => section.id));
  if (!taken.has(type)) return type;
  let index = 2;
  while (taken.has(`${type}-${index}`)) index += 1;
  return `${type}-${index}`;
}

export function createSection<T extends SectionType>(
  type: T,
  existing: readonly Section[],
  props: Partial<SectionPropsMap[T]> = {},
): Section<T> {
  return {
    id: createSectionId(type, existing),
    type,
    props: { ...clone(sectionDefaults[type]), ...clone(props) },
  } as Section<T>;
}

export function findSection(document: SiteDocument, id: string): Section | undefined {
  return document.sections.find((section) => section.id === id);
}

/* ------------------------------------------------------- starting document */

export function createStarterDocument(): SiteDocument {
  const sections: Section[] = [];
  for (const type of ["nav", "hero"] as const) {
    sections.push(createSection(type, sections));
  }
  return {
    version: DOCUMENT_VERSION,
    meta: {
      name: "Atelier North",
      description: "An architecture and interiors studio.",
    },
    theme: clone(defaultTheme),
    sections,
  };
}

/* -------------------------------------------------------------- validation */

export type ValidationIssue = { path: string; message: string };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/**
 * Structural check only. This exists to catch malformed documents coming back
 * from a model or out of storage; it is deliberately permissive about the
 * contents of individual section props, which `applyOps` sanitizes instead.
 */
export function validateDocument(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof value !== "object" || value === null) {
    return [{ path: "", message: "Document must be an object." }];
  }
  const document = value as Partial<SiteDocument>;

  if (document.version !== DOCUMENT_VERSION) {
    issues.push({ path: "version", message: `Expected version ${DOCUMENT_VERSION}.` });
  }
  if (typeof document.meta?.name !== "string" || document.meta.name.trim() === "") {
    issues.push({ path: "meta.name", message: "Site name is required." });
  }

  const theme = document.theme;
  if (typeof theme !== "object" || theme === null) {
    issues.push({ path: "theme", message: "Theme is required." });
  } else {
    for (const key of ["background", "foreground", "accent"] as const) {
      if (!isHexColor(theme[key])) {
        issues.push({ path: `theme.${key}`, message: "Must be a hex color." });
      }
    }
    if (!["editorial", "modern", "geometric"].includes(theme.font)) {
      issues.push({ path: "theme.font", message: "Unknown font direction." });
    }
  }

  if (!Array.isArray(document.sections)) {
    issues.push({ path: "sections", message: "Sections must be an array." });
    return issues;
  }

  const seen = new Set<string>();
  document.sections.forEach((section, index) => {
    const at = `sections[${index}]`;
    if (!isSectionType((section as Section)?.type)) {
      issues.push({ path: `${at}.type`, message: "Unknown section type." });
    }
    const id = (section as Section)?.id;
    if (typeof id !== "string" || id === "") {
      issues.push({ path: `${at}.id`, message: "Section id is required." });
    } else if (seen.has(id)) {
      issues.push({ path: `${at}.id`, message: `Duplicate section id "${id}".` });
    } else {
      seen.add(id);
    }
  });

  return issues;
}
