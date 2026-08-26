/**
 * Renders a SiteDocument to a complete standalone HTML document.
 *
 * Pure and dependency-free so it can run on the client (iframe srcDoc), on the
 * server (published output, OG screenshots), or in tests. Every string that
 * originates from the document is escaped — the whole point of a constrained
 * schema is that a model can never inject markup here.
 */

import type { Link, Section, SiteDocument, Theme } from "./schema.ts";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );
}

function safeHref(href: unknown): string {
  const value = String(href ?? "#").trim();
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(value)) return escapeHtml(value);
  return "#";
}

function anchor(link: Link | null | undefined, className = ""): string {
  if (!link?.label) return "";
  const attr = className ? ` class="${className}"` : "";
  return `<a${attr} href="${safeHref(link.href)}">${escapeHtml(link.label)}</a>`;
}

const fontStacks: Record<Theme["font"], { display: string; body: string }> = {
  editorial: {
    display: "Georgia, 'Times New Roman', serif",
    body: "Georgia, 'Times New Roman', serif",
  },
  modern: {
    display: "'Helvetica Neue', Arial, sans-serif",
    body: "'Helvetica Neue', Arial, sans-serif",
  },
  geometric: {
    display: "'Futura', 'Avenir Next', 'Century Gothic', sans-serif",
    body: "'Avenir Next', 'Segoe UI', sans-serif",
  },
};

const radiusScale: Record<Theme["radius"], string> = {
  sharp: "0px",
  soft: "10px",
  round: "22px",
};

const densityScale: Record<Theme["density"], string> = {
  compact: "5%",
  comfortable: "8%",
  spacious: "12%",
};

function themeVariables(theme: Theme): string {
  const fonts = fontStacks[theme.font] ?? fontStacks.editorial;
  return [
    `--bg:${theme.background}`,
    `--fg:${theme.foreground}`,
    `--accent:${theme.accent}`,
    `--muted:color-mix(in srgb, var(--fg) 62%, var(--bg))`,
    `--hairline:color-mix(in srgb, var(--fg) 18%, transparent)`,
    `--surface:color-mix(in srgb, var(--fg) 6%, transparent)`,
    `--display:${fonts.display}`,
    `--body:${fonts.body}`,
    `--radius:${radiusScale[theme.radius] ?? "0px"}`,
    `--pad:${densityScale[theme.density] ?? "8%"}`,
  ].join(";");
}

/* ------------------------------------------------------ section renderers */

function renderSection(section: Section, document: SiteDocument): string {
  const id = escapeHtml(section.id);

  switch (section.type) {
    case "announcement": {
      const { text, link } = section.props;
      return `<div class="announce">${escapeHtml(text)}${link ? ` ${anchor(link)}` : ""}</div>`;
    }

    case "nav": {
      const { links, sticky, showBrand } = section.props;
      return `<nav class="nav${sticky ? " sticky" : ""}">${
        showBrand ? `<strong>${escapeHtml(document.meta.name).toUpperCase()}</strong>` : "<span></span>"
      }<div class="nav-links">${links.map((link) => anchor(link)).join("")}</div></nav>`;
    }

    case "hero": {
      const { eyebrow, headline, subhead, primaryCta, secondaryCta, visual, layout } = section.props;
      const art =
        visual === "architectural"
          ? `<div class="visual"><span class="sun"></span><span class="wall w1"></span><span class="wall w2"></span><span class="wall w3"></span></div>`
          : visual === "gradient"
            ? `<div class="visual gradient"></div>`
            : "";
      return `<section id="${id}" class="hero hero-${escapeHtml(layout)}${art ? "" : " no-visual"}">
        <div class="copy">
          ${eyebrow ? `<p class="label">${escapeHtml(eyebrow)}</p>` : ""}
          <h1>${escapeHtml(headline)}</h1>
          ${subhead ? `<p class="lede">${escapeHtml(subhead)}</p>` : ""}
          <div class="actions">${anchor(primaryCta, "cta")}${anchor(secondaryCta, "cta ghost")}</div>
        </div>${art}
      </section>`;
    }

    case "services": {
      const { label, heading, items, columns } = section.props;
      return `<section id="${id}" class="band services cols-${columns}">
        ${label ? `<p class="label">${escapeHtml(label)}</p>` : ""}
        ${heading ? `<h2>${escapeHtml(heading)}</h2>` : ""}
        <div class="grid">${items
          .map(
            (item) =>
              `<article><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`,
          )
          .join("")}</div>
      </section>`;
    }

    case "gallery": {
      const { label, heading, items, columns } = section.props;
      return `<section id="${id}" class="band gallery cols-${columns}">
        ${label ? `<p class="label">${escapeHtml(label)}</p>` : ""}
        ${heading ? `<h2>${escapeHtml(heading)}</h2>` : ""}
        <div class="grid">${items
          .map(
            (item) =>
              `<figure class="tile tone-${escapeHtml(item.tone)}"><figcaption>${escapeHtml(item.caption)}</figcaption></figure>`,
          )
          .join("")}</div>
      </section>`;
    }

    case "stats": {
      return `<section id="${id}" class="band stats"><div class="grid">${section.props.items
        .map(
          (item) =>
            `<div><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`,
        )
        .join("")}</div></section>`;
    }

    case "process": {
      const { label, heading, steps } = section.props;
      // Numbers are meaningful here: this section is an ordered sequence.
      return `<section id="${id}" class="band process">
        ${label ? `<p class="label">${escapeHtml(label)}</p>` : ""}
        ${heading ? `<h2>${escapeHtml(heading)}</h2>` : ""}
        <ol class="grid">${steps
          .map(
            (step, index) =>
              `<li><span class="step-index">${String(index + 1).padStart(2, "0")}</span><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.body)}</p></li>`,
          )
          .join("")}</ol>
      </section>`;
    }

    case "testimonial": {
      const { quote, attribution, role } = section.props;
      return `<section id="${id}" class="band testimonial">
        <blockquote>${escapeHtml(quote)}</blockquote>
        <p class="attribution">${escapeHtml(attribution)}${role ? ` <span>· ${escapeHtml(role)}</span>` : ""}</p>
      </section>`;
    }

    case "cta": {
      const { heading, body, button } = section.props;
      return `<section id="${id}" class="band cta-band">
        <div><h2>${escapeHtml(heading)}</h2>${body ? `<p>${escapeHtml(body)}</p>` : ""}</div>
        ${anchor(button, "cta")}
      </section>`;
    }

    case "contact": {
      const { label, heading, fields, buttonLabel } = section.props;
      const inputs = fields
        .map((field) =>
          field.type === "textarea"
            ? `<textarea name="${escapeHtml(field.name)}" aria-label="${escapeHtml(field.label)}" placeholder="${escapeHtml(field.label)}"></textarea>`
            : `<input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type)}" aria-label="${escapeHtml(field.label)}" placeholder="${escapeHtml(field.label)}" required>`,
        )
        .join("");
      return `<section id="${id}" class="band contact">
        <div>${label ? `<p class="label">${escapeHtml(label)}</p>` : ""}<h2>${escapeHtml(heading)}</h2></div>
        <form data-canvas-form>${inputs}<button type="submit">${escapeHtml(buttonLabel)}</button></form>
      </section>`;
    }

    case "footer": {
      const { columns, note } = section.props;
      return `<footer id="${id}" class="footer">
        <div class="grid">${columns
          .map(
            (column) =>
              `<div><p class="label">${escapeHtml(column.title)}</p>${column.links
                .map((link) => anchor(link))
                .join("")}</div>`,
          )
          .join("")}</div>
        ${note ? `<small>${escapeHtml(note)}</small>` : ""}
      </footer>`;
    }

    default:
      return "";
  }
}

/* ------------------------------------------------------------------- CSS */

const baseStyles = `
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--body);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
h1,h2,h3{font-family:var(--display);font-weight:400;letter-spacing:-.03em;margin:0}
.label{font-size:10px;letter-spacing:.18em;font-weight:700;opacity:.62;margin:0 0 6px;text-transform:uppercase}
.announce{padding:11px 6%;background:var(--accent);color:var(--bg);font-size:12px;letter-spacing:.06em;display:flex;gap:14px;justify-content:center}
.announce a{text-decoration:underline;text-underline-offset:3px}
.nav{height:76px;display:flex;align-items:center;justify-content:space-between;padding:0 6%;border-bottom:1px solid var(--hairline);font-size:11px;letter-spacing:.12em}
.nav.sticky{position:sticky;top:0;z-index:9;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px)}
.nav strong{font-size:13px;letter-spacing:.16em}
.nav-links{display:flex;gap:26px}
.nav-links a:hover{color:var(--accent)}
.hero{min-height:min(78vh,720px);display:grid;grid-template-columns:.9fr 1.1fr;gap:5vw;align-items:center;padding:var(--pad) 6%}
.hero.no-visual,.hero-centered{grid-template-columns:1fr}
.hero-centered{text-align:center;justify-items:center}
.hero h1{font-size:clamp(44px,7vw,104px);line-height:.94;margin:22px 0}
.lede{max-width:52ch;font-size:17px;line-height:1.65;color:var(--muted);margin:0}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.cta{display:inline-flex;align-items:center;gap:10px;padding:14px 22px;border-radius:var(--radius);background:var(--accent);color:var(--bg);font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:var(--body)}
.cta.ghost{background:transparent;color:var(--fg);border:1px solid var(--hairline)}
.cta:hover{opacity:.88}
.visual{height:min(60vw,600px);position:relative;overflow:hidden;border-radius:var(--radius);background:color-mix(in srgb,var(--accent) 30%,#a99d83)}
.visual.gradient{background:radial-gradient(120% 90% at 22% 12%,color-mix(in srgb,var(--accent) 72%,var(--bg)),var(--bg) 72%)}
.sun{position:absolute;width:45%;aspect-ratio:1;border-radius:50%;background:color-mix(in srgb,var(--accent) 55%,#f4dfae);right:8%;top:8%;box-shadow:0 0 80px color-mix(in srgb,var(--accent) 40%,transparent)}
.wall{position:absolute;display:block;box-shadow:25px 25px 45px #0003}
.w1{width:45%;height:82%;left:8%;bottom:0;background:color-mix(in srgb,var(--bg) 85%,white);transform:skewY(-7deg)}
.w2{width:55%;height:66%;right:-8%;bottom:-3%;background:color-mix(in srgb,var(--fg) 55%,#967c5d);transform:skewY(7deg)}
.w3{width:20%;height:58%;left:39%;bottom:0;background:var(--fg);transform:skewY(-7deg)}
.band{padding:var(--pad) 6%;border-top:1px solid var(--hairline)}
.band h2{font-size:clamp(30px,3.6vw,48px);margin:0 0 26px}
.grid{display:grid;gap:2px}
.cols-2 .grid{grid-template-columns:repeat(2,1fr)}
.cols-3 .grid{grid-template-columns:repeat(3,1fr)}
.cols-4 .grid{grid-template-columns:repeat(4,1fr)}
.services article{padding:34px;background:var(--surface);border-radius:var(--radius)}
.services h3{font-size:28px;margin-bottom:10px}
.services p{line-height:1.6;color:var(--muted);margin:0}
.gallery .grid{gap:14px}
.tile{margin:0;aspect-ratio:4/5;border-radius:var(--radius);display:flex;align-items:flex-end;padding:18px;font-size:12px;letter-spacing:.08em}
.tone-light{background:color-mix(in srgb,var(--bg) 78%,white);color:var(--fg)}
.tone-mid{background:color-mix(in srgb,var(--fg) 28%,var(--bg))}
.tone-dark{background:color-mix(in srgb,var(--fg) 82%,var(--bg));color:var(--bg)}
.tone-accent{background:var(--accent);color:var(--bg)}
.stats .grid{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:30px}
.stats strong{display:block;font-family:var(--display);font-size:clamp(38px,5vw,64px);font-weight:400;line-height:1}
.stats span{font-size:12px;letter-spacing:.1em;color:var(--muted)}
.process ol{list-style:none;margin:0;padding:0;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:30px}
.step-index{font-size:11px;letter-spacing:.14em;color:var(--accent);display:block;margin-bottom:12px}
.process h3{font-size:24px;margin-bottom:8px}
.process p{line-height:1.6;color:var(--muted);margin:0}
.testimonial{text-align:center}
.testimonial blockquote{margin:0 auto;max-width:26ch;font-family:var(--display);font-size:clamp(26px,3.4vw,44px);line-height:1.24}
.attribution{margin-top:22px;font-size:12px;letter-spacing:.1em;color:var(--muted)}
.cta-band{display:flex;flex-wrap:wrap;gap:26px;align-items:center;justify-content:space-between}
.cta-band p{color:var(--muted);margin:10px 0 0;max-width:46ch}
.contact{display:grid;grid-template-columns:1fr 1fr;gap:6vw}
.contact form{display:grid;gap:10px;align-content:start}
.contact input,.contact textarea{width:100%;border:0;border-bottom:1px solid color-mix(in srgb,var(--fg) 28%,transparent);background:transparent;color:inherit;font:inherit;font-size:15px;padding:14px 4px;outline:none}
.contact input:focus,.contact textarea:focus{border-bottom-color:var(--accent)}
.contact textarea{min-height:100px;resize:vertical}
.contact button{justify-self:start;margin-top:14px;border:0;border-radius:var(--radius);background:var(--accent);color:var(--bg);font:inherit;font-size:12px;letter-spacing:.1em;text-transform:uppercase;padding:14px 22px;cursor:pointer}
.footer{padding:var(--pad) 6% 40px;border-top:1px solid var(--hairline)}
.footer .grid{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:30px}
.footer a{display:block;font-size:14px;line-height:2;color:var(--muted)}
.footer a:hover{color:var(--accent)}
.footer small{display:block;margin-top:40px;font-size:11px;letter-spacing:.1em;color:var(--muted)}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media (max-width:820px){
  .nav-links{display:none}
  .hero{grid-template-columns:1fr;padding:12% 7%}
  .visual{height:320px}
  .cols-2 .grid,.cols-3 .grid,.cols-4 .grid,.contact{grid-template-columns:1fr}
  .hero h1{font-size:46px}
}`;

/* --------------------------------------------------------------- document */

export type RenderOptions = {
  /**
   * Only pass this when the output will be used as an <iframe srcDoc>. A
   * srcdoc document's URL is about:srcdoc, but it otherwise inherits its
   * *base* URL (used to resolve relative/fragment hrefs) from the parent
   * page — so an in-page link like href="#hero" would resolve against the
   * parent's URL and trigger a real cross-document navigation instead of an
   * in-page scroll. Setting <base href="about:srcdoc"> fixes that.
   *
   * A real, standalone page (e.g. published output served at its own URL)
   * must NOT set this — its base already correctly matches its own address,
   * and forcing it to "about:srcdoc" would break every in-page link there
   * the same way, just in the opposite direction.
   */
  base?: string;
};

export function renderSite(document: SiteDocument, options: RenderOptions = {}): string {
  const body = document.sections.map((section) => renderSection(section, document)).join("\n");
  const hasForm = document.sections.some((section) => section.type === "contact");

  const formScript = hasForm
    ? `<script>document.querySelectorAll('[data-canvas-form]').forEach(function(form){form.addEventListener('submit',function(event){event.preventDefault();var button=form.querySelector('button');if(button)button.textContent='Message sent';});});</script>`
    : "";

  const baseTag = options.base ? `<base href="${escapeHtml(options.base)}">` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${baseTag}
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(document.meta.name)}</title>
<meta name="description" content="${escapeHtml(document.meta.description)}">
<style>:root{${themeVariables(document.theme)}}${baseStyles}</style>
</head>
<body>${body}${formScript}</body>
</html>`;
}
