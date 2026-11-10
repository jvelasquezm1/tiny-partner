import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addGuide, GuideConflictError, InvalidGuideError } from "./sync-guidance.js";

const today = new Date("2026-11-10T08:00:00Z");
const guide = {
  fileName: "Sueño Seguro.md",
  title: "CDC: Sueño seguro",
  url: "https://www.cdc.gov/sueno",
  source: "CDC, dominio público",
  content: "# Sueño seguro\n\nBoca arriba.",
};

let path: string;
let dir: URL;
beforeEach(async () => {
  path = await mkdtemp(join(tmpdir(), "guidance-"));
  dir = pathToFileURL(`${path}/`);
});
afterEach(() => rm(path, { recursive: true }));

describe("addGuide", () => {
  it("writes the guide under a safe file name with the same front matter as the hand-written ones", async () => {
    expect(await addGuide(guide, dir, today)).toBe("sueno-seguro.md");
    expect(await readFile(new URL("sueno-seguro.md", dir), "utf8")).toBe(
      "---\ntitle: CDC: Sueño seguro\nurl: https://www.cdc.gov/sueno\nsource: CDC, dominio público\nretrieved: 2026-11-10\n---\n# Sueño seguro\n\nBoca arriba.\n",
    );
  });

  it("replaces the upload's own front matter with the form's", async () => {
    const content = "---\r\ntitle: Old\r\nurl: https://old.example\r\n---\r\n# Body";
    const file = await addGuide({ ...guide, source: "", content }, dir, today);
    expect(await readFile(new URL(file, dir), "utf8")).toBe(
      "---\ntitle: CDC: Sueño seguro\nurl: https://www.cdc.gov/sueno\nretrieved: 2026-11-10\n---\n# Body\n",
    );
  });

  it("never overwrites a file or cites one URL twice", async () => {
    await addGuide(guide, dir, today);
    await expect(addGuide({ ...guide, url: "https://www.cdc.gov/otra" }, dir, today)).rejects.toThrow(GuideConflictError);
    await expect(addGuide({ ...guide, fileName: "otra.md" }, dir, today)).rejects.toThrow(GuideConflictError);
  });

  it("rejects a missing title, a non-web URL or an empty file", async () => {
    await expect(addGuide({ ...guide, title: " " }, dir, today)).rejects.toThrow(new InvalidGuideError("Falta el título"));
    await expect(addGuide({ ...guide, url: "javascript:alert(1)" }, dir, today)).rejects.toThrow(InvalidGuideError);
    await expect(addGuide({ ...guide, content: "\n" }, dir, today)).rejects.toThrow(new InvalidGuideError("El archivo está vacío"));
  });

  it("keeps a file name that cannot leave guidance/", async () => {
    await writeFile(new URL("README.md", dir), "not a guide");
    expect(await addGuide({ ...guide, fileName: "../../etc/passwd.md" }, dir, today)).toBe("etc-passwd.md");
  });
});
