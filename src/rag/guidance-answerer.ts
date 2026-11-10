import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_EFFORT, CLAUDE_MODEL } from "../models.js";
import type { GuidanceChunk } from "./guidance-repository.js";
import type { Retriever } from "./retriever.js";

export const NO_SOURCE_REPLY =
  "No tengo una fuente fiable para responder eso. Consúltalo con tu pediatra.";
const DISCLAIMER = "ℹ️ Información general, no consejo médico.";
export const NO_SOURCE_MARKER = "NO_SOURCE";

export const GUIDANCE_SYSTEM = `You answer a new parent's general baby care question using only the documents provided.
Every factual sentence must be supported by the documents. If they do not answer the question, reply with exactly ${NO_SOURCE_MARKER}.
Answer in the language the question is written in, in at most four short sentences, even when the documents are in another language: say what they say in the parent's words.
Do not diagnose or recommend treatment.`;

/** Writes an answer from the passages and says which passage backs each part. One per model provider. */
export interface GroundedWriter {
  /** Null when the model refuses. */
  write(question: string, passages: GuidanceChunk[]): Promise<CitedText[] | null>;
}

export class GuidanceAnswerer {
  constructor(
    private readonly writer: GroundedWriter,
    private readonly retriever: Retriever,
  ) {}

  async answer(question: string): Promise<string> {
    return (await this.respond(question)).text;
  }

  /** The reply plus the passages it was grounded on, so the eval can judge faithfulness. */
  async respond(question: string): Promise<{ text: string; passages: GuidanceChunk[] }> {
    const passages = await this.retriever.retrieve(question);
    if (passages.length === 0) return { text: NO_SOURCE_REPLY, passages };

    const blocks = await this.writer.write(question, passages);
    return { text: blocks ? renderWithCitations(blocks, passages) : NO_SOURCE_REPLY, passages };
  }
}

/** Claude's citations API ties every text block to the documents it quotes. */
export class ClaudeWriter implements GroundedWriter {
  constructor(private readonly client: Anthropic) {}

  async write(question: string, passages: GuidanceChunk[]): Promise<CitedText[] | null> {
    const response = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      output_config: { effort: CLAUDE_EFFORT },
      system: GUIDANCE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...passages.map((passage) => ({
              type: "document" as const,
              source: { type: "text" as const, media_type: "text/plain" as const, data: passage.content },
              title: passage.sourceTitle,
              citations: { enabled: true },
            })),
            { type: "text", text: question },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;

    return response.content.flatMap((block) =>
      block.type === "text"
        ? [{ text: block.text, documentIndexes: (block.citations ?? []).flatMap((c) => ("document_index" in c ? [c.document_index] : [])) }]
        : [],
    );
  }
}

export interface CitedText {
  text: string;
  documentIndexes: number[];
}

/**
 * Turns cited text blocks into "answer [1][2]" plus a numbered source list.
 * An answer without a single citation is not grounded, so it is never shown.
 */
export function renderWithCitations(blocks: CitedText[], passages: GuidanceChunk[]): string {
  const sourceNumbers = new Map<string, number>();
  const numberFor = (url: string) => {
    if (!sourceNumbers.has(url)) sourceNumbers.set(url, sourceNumbers.size + 1);
    return sourceNumbers.get(url)!;
  };

  const body = blocks
    .map(({ text, documentIndexes }) => {
      const markers = [...new Set(documentIndexes.flatMap((i) => (passages[i] ? [numberFor(passages[i].sourceUrl)] : [])))];
      return text + markers.map((n) => `[${n}]`).join("");
    })
    .join("")
    // The model now and then writes its plan as text ("<reasoning>Answer in Spanish…</reasoning>"): never the parent's to read.
    .replace(/<(reasoning|thinking)>[\s\S]*?<\/\1>/g, "")
    // Haiku 5.5 sometimes writes citation markup into the text ('(cite index="1-5">…</cite>'): the markers above already cite.
    .replace(/\(?<?\/?cite\b[^>]*>/g, "")
    .trim();

  if (sourceNumbers.size === 0 || body.includes(NO_SOURCE_MARKER)) return NO_SOURCE_REPLY;

  const titles = new Map(passages.map((p) => [p.sourceUrl, p.sourceTitle]));
  const sources = [...sourceNumbers].map(([url, n]) => `[${n}] ${titles.get(url)} — ${url}`).join("\n");
  return `${body}\n\n${sources}\n\n${DISCLAIMER}`;
}
