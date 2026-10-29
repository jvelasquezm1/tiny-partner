# Guidance sources

Put one markdown file per source here, with `title` and `url` front matter (see `src/rag/ingest.ts`), then run `pnpm ingest`.

Rules:
- Only content whose license allows reuse. Check each source's terms before adding it.
- Keep the `url` pointing at the original page: every answer cites it.
- Prefer official public health guidance over blogs or forums.

## Current sources

| File | Source | Terms |
|---|---|---|
| `cdc-sueno-seguro.md` | CDC: Cómo cuidar a los bebés para que duerman de forma segura | Public domain |
| `cdc-lactancia-beneficios.md` | CDC: La lactancia materna beneficia tanto al bebé como a la mamá | Public domain |
| `cdc-crianza-bebes-0-1.md` | CDC: Consejos para la crianza positiva: bebés (de 0 a 1 año) | Public domain |
| `cdc-desarrollo-2-meses.md` | CDC: Indicadores del desarrollo a los 2 meses | Public domain |

Source: Centers for Disease Control and Prevention (CDC). Content is copied verbatim from the pages
linked in each file's `url`, keeping only the guidance sections: navigation, videos, links to other
sites and US-only resources (helplines, state programs) are left out. Use of this material does not
imply endorsement by the CDC or the U.S. Department of Health and Human Services. CDC guidance is
written for the United States; topics that depend on the country (vaccine schedules, emergency
numbers) are deliberately not included.
