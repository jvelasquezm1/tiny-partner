import type Anthropic from "@anthropic-ai/sdk";
import type { GuidanceChunk } from "./guidance-repository.js";
import type { Retriever } from "./retriever.js";

export const NO_SOURCE_REPLY =
  "No tengo una fuente fiable para responder eso. Consúltalo con tu pediatra.";
const DISCLAIMER = "ℹ️ Información general, no consejo médico.";
const NO_SOURCE_MARKER = "NO_SOURCE";

const SYSTEM = `You answer a new parent's general baby care question using only the documents provided.
Every factual sentence must be supported by the documents. If they do not answer the question, reply with exactly ${NO_SOURCE_MARKER}.
Answer in the parent's language, in at most four short sentences. Do not diagnose or recommend treatment.`;

export class GuidanceAnswerer {
  constructor(
    private readonly client: Anthropic,
    private readonly retriever: Retriever,
  ) {}

  async answer(question: string): Promise<string> {
    const passages = await this.retriever.retrieve(question);
    if (passages.length === 0) return NO_SOURCE_REPLY;

    const response = await this.client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
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
    if (response.stop_reason === "refusal") return NO_SOURCE_REPLY;

    return renderWithCitations(
      response.content.flatMap((block) =>
        block.type === "text"
          ? [{ text: block.text, documentIndexes: (block.citations ?? []).flatMap((c) => ("document_index" in c ? [c.document_index] : [])) }]
          : [],
      ),
      passages,
    );
  }
}

export interface CitedText {
  text: string;
  documentIndexes: number[];
}

/**
 * Turns Claude's cited text blocks into "answer [1][2]" plus a numbered source list.
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
    .trim();

  if (sourceNumbers.size === 0 || body.includes(NO_SOURCE_MARKER)) return NO_SOURCE_REPLY;

  const titles = new Map(passages.map((p) => [p.sourceUrl, p.sourceTitle]));
  const sources = [...sourceNumbers].map(([url, n]) => `[${n}] ${titles.get(url)} — ${url}`).join("\n");
  return `${body}\n\n${sources}\n\n${DISCLAIMER}`;
}
