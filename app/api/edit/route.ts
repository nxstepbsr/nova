import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";

import { applyOps, type ApplyResult, type EditOp, type RejectedOp } from "@/lib/site/ops";
import { sectionDefaults, validateDocument, type SiteDocument } from "@/lib/site/schema";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";

/**
 * Nova's real edit tool. `patch`/`props` are left as open objects rather than
 * fully-typed per section — applyOps already drops any key that doesn't
 * exist on the target section's defaults, so over-constraining the schema
 * here would just duplicate validation that already happens safely server-side.
 */
const EDIT_TOOL: Anthropic.Messages.Tool = {
  name: "propose_edits",
  description:
    "Propose one or more edits to the current site document to satisfy the user's request.",
  input_schema: {
    type: "object",
    properties: {
      ops: {
        type: "array",
        description: "The edit operations to apply, in order.",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: [
                "set_meta",
                "set_theme",
                "add_section",
                "remove_section",
                "move_section",
                "update_section",
              ],
            },
            patch: {
              type: "object",
              description: "Used by set_meta (name, description), set_theme, and update_section.",
            },
            type: {
              type: "string",
              description: "Used by add_section: the section type to add.",
            },
            props: {
              type: "object",
              description: "Used by add_section: initial property overrides for the new section.",
            },
            index: {
              type: "number",
              description: "Used by add_section and move_section: the target position.",
            },
            id: {
              type: "string",
              description:
                "Used by remove_section, move_section, and update_section: the exact id of an existing section.",
            },
          },
          required: ["op"],
        },
      },
    },
    required: ["ops"],
  },
};

function systemPrompt(document: SiteDocument): string {
  return `You are Nova, the AI behind Canvas, a live website builder. The user describes a change in \
plain language and you translate it into edit operations against a structured site document. You \
never write raw HTML or CSS — every change goes through the propose_edits tool.

Section types and an example of their default shape (adapt values to the request; don't just copy \
these verbatim):
${JSON.stringify(sectionDefaults, null, 2)}

Theme fields: background, foreground, and accent are hex colors (e.g. "#151a17"). font is one of \
"editorial" | "modern" | "geometric". radius is one of "sharp" | "soft" | "round". density is one \
of "compact" | "comfortable" | "spacious".

Current document:
${JSON.stringify(document, null, 2)}

Call propose_edits with the ops needed to satisfy the request. Reference existing section ids \
exactly as they appear above when updating, removing, or moving a section. Only include the fields \
relevant to each op — omit anything you're not setting. If the request doesn't call for any change \
to the document (e.g. it's a question, or asks for something this tool can't do), call \
propose_edits with an empty ops array.`;
}

async function requestOps(
  client: Anthropic,
  document: SiteDocument,
  prompt: string,
  feedback?: string,
): Promise<EditOp[]> {
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: feedback ? `${prompt}\n\n${feedback}` : prompt },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt(document),
    tools: [EDIT_TOOL],
    tool_choice: { type: "tool", name: "propose_edits" },
    messages,
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return [];

  const input = toolUse.input as { ops?: unknown };
  return Array.isArray(input.ops) ? (input.ops as EditOp[]) : [];
}

function feedbackFor(rejected: RejectedOp[]): string {
  const lines = rejected.map((entry) => `- ${JSON.stringify(entry.op)}: ${entry.reason}`);
  return `Your previous attempt had ${rejected.length} edit(s) rejected:\n${lines.join("\n")}\n\
Propose a corrected, complete set of ops for the original request.`;
}

function summarize(result: ApplyResult): string {
  if (result.applied.length === 0) {
    return result.rejected.length > 0
      ? `I understood that, but couldn't apply it: ${result.rejected[0].reason}`
      : "I didn't find anything to change for that.";
  }
  const unique = [...new Set(result.changes)];
  const list =
    unique.length <= 1 ? (unique[0] ?? "made no changes") : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  const note =
    result.rejected.length > 0
      ? ` (${result.rejected.length} edit${result.rejected.length === 1 ? "" : "s"} didn't apply: ${result.rejected[0].reason})`
      : "";
  return `Done — I ${list}.${note}`;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });
  }

  let body: { document?: unknown; prompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (validateDocument(body.document).length > 0) {
    return NextResponse.json({ error: "Invalid document." }, { status: 400 });
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
  }

  const document = body.document as SiteDocument;
  const prompt = body.prompt.trim();
  const client = new Anthropic({ apiKey });

  try {
    let ops = await requestOps(client, document, prompt);
    let result = applyOps(document, ops);

    if (result.rejected.length > 0) {
      const retryOps = await requestOps(client, document, prompt, feedbackFor(result.rejected));
      const retryResult = applyOps(document, retryOps);
      if (retryResult.rejected.length < result.rejected.length) {
        ops = retryOps;
        result = retryResult;
      }
    }

    return NextResponse.json({
      ops,
      reply: summarize(result),
      unmatched: ops.length === 0,
    });
  } catch (error) {
    console.error("[/api/edit]", error);
    return NextResponse.json({ error: "The model request failed." }, { status: 502 });
  }
}
