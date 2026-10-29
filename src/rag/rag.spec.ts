import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./chunk.js";
import { reciprocalRankFusion } from "./fuse.js";
import { NO_SOURCE_REPLY, renderWithCitations } from "./guidance-answerer.js";
import type { GuidanceChunk } from "./guidance-repository.js";

describe("chunkMarkdown", () => {
  it("keeps the nearest heading on every chunk", () => {
    const chunks = chunkMarkdown("# Feeding\n\nEvery 2 to 3 hours.\n\n# Sleep\n\nOn their back.");
    expect(chunks).toEqual(["# Feeding\n\nEvery 2 to 3 hours.", "# Sleep\n\nOn their back."]);
  });

  it("splits long sections under the size limit and repeats the heading", () => {
    const paragraph = "word ".repeat(40).trim();
    const chunks = chunkMarkdown(`# Feeding\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`, { maxChars: 300, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.startsWith("# Feeding")).toBe(true);
  });

  it("prefixes every chunk with its heading path", () => {
    const chunks = chunkMarkdown("# At 2 months\n\n## Social\n\n- Smiles back\n\n## Speech\n\n- Coos");
    expect(chunks).toEqual(["# At 2 months\n## Social\n\n- Smiles back", "# At 2 months\n## Speech\n\n- Coos"]);
  });

  it("splits a list too long for one chunk between its items", () => {
    const list = Array.from({ length: 12 }, (_, i) => `- Tip ${i}: ${"word ".repeat(10).trim()}`).join("\n");
    const chunks = chunkMarkdown(`# Tips\n\n${list}`, { maxChars: 300, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
    expect(chunks.at(-1)).toContain("- Tip 11:");
  });
});

describe("reciprocalRankFusion", () => {
  it("ranks an item found by both searches above items found by one", () => {
    const fused = reciprocalRankFusion([["a", "b"], ["c", "b"]], (id) => id);
    expect(fused[0]).toBe("b");
    expect(fused).toHaveLength(3);
  });
});

describe("renderWithCitations", () => {
  const passages: GuidanceChunk[] = [
    { id: 1, sourceTitle: "Feeding guide", sourceUrl: "https://example.org/feeding", content: "" },
    { id: 2, sourceTitle: "Feeding guide", sourceUrl: "https://example.org/feeding", content: "" },
    { id: 3, sourceTitle: "Sleep guide", sourceUrl: "https://example.org/sleep", content: "" },
  ];

  it("numbers sources once, in order of first citation", () => {
    const text = renderWithCitations(
      [
        { text: "Every 2 to 3 hours.", documentIndexes: [0, 1] },
        { text: " Always on their back.", documentIndexes: [2] },
      ],
      passages,
    );
    expect(text).toContain("Every 2 to 3 hours.[1] Always on their back.[2]");
    expect(text).toContain("[1] Feeding guide — https://example.org/feeding\n[2] Sleep guide — https://example.org/sleep");
  });

  it("refuses an answer that cites nothing", () => {
    expect(renderWithCitations([{ text: "Probably fine.", documentIndexes: [] }], passages)).toBe(NO_SOURCE_REPLY);
  });

  it("maps the model's no-source marker to the fixed reply", () => {
    expect(renderWithCitations([{ text: "NO_SOURCE", documentIndexes: [] }], passages)).toBe(NO_SOURCE_REPLY);
  });
});
