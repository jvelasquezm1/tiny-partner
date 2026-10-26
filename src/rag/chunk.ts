export interface ChunkOptions {
  maxChars: number;
  overlapChars: number;
}

const DEFAULTS: ChunkOptions = { maxChars: 1200, overlapChars: 200 };

/**
 * Splits markdown into chunks on paragraph boundaries. Each chunk starts with its section heading
 * so a passage like "Up to 8 times a day" keeps the context it needs to be retrieved and cited.
 * Consecutive chunks of one section overlap by the end of the previous chunk.
 */
export function chunkMarkdown(markdown: string, options: ChunkOptions = DEFAULTS): string[] {
  return splitSections(markdown).flatMap(({ heading, paragraphs }) => chunkSection(heading, paragraphs, options));
}

function splitSections(markdown: string): { heading: string; paragraphs: string[] }[] {
  const sections = [{ heading: "", paragraphs: [] as string[] }];
  for (const paragraph of markdown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    if (paragraph.startsWith("#")) sections.push({ heading: paragraph, paragraphs: [] });
    else sections.at(-1)!.paragraphs.push(paragraph);
  }
  return sections.filter((section) => section.paragraphs.length > 0);
}

function chunkSection(heading: string, paragraphs: string[], { maxChars, overlapChars }: ChunkOptions): string[] {
  const prefix = heading ? `${heading}\n\n` : "";
  const chunks: string[] = [];
  let body: string[] = [];

  for (const paragraph of paragraphs) {
    const candidate = [...body, paragraph].join("\n\n");
    if (body.length > 0 && prefix.length + candidate.length > maxChars) {
      const previous = body.join("\n\n");
      chunks.push(prefix + previous);
      const tail = previous.slice(-overlapChars);
      body = [tail.slice(tail.indexOf(" ") + 1), paragraph];
    } else {
      body.push(paragraph);
    }
  }
  chunks.push(prefix + body.join("\n\n"));
  return chunks;
}
