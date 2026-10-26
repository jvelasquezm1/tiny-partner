# tiny-partner

An AI assistant for new parents, in Telegram. Log feeds, sleep and diapers in plain language, ask about your baby's day, and get answers grounded in cited pediatric guidance.

> Not medical advice. Messages that look urgent get a fixed "call emergency services" reply; no model improvises.

<!-- TODO: 15-second demo GIF -->

## How it works

```
Telegram message
      │
      ▼
 Jev (System 1)  ── urgent? ──────────────▶ fixed safety reply (no LLM)
      │ intent: log | ask_about_data | ask_guidance | other
      ├─ log ───────────▶ Claude structured output (Zod) ─▶ Postgres
      ├─ ask_about_data ▶ Claude + tools (last_event, events_between) ─▶ answer
      └─ ask_guidance ──▶ local embedding (e5-small) ─▶ pgvector + full text (rank fusion)
                              ─▶ Jev triage ("does this passage help?") ─▶ Claude with citations
```

**Two kinds of model, each doing what it is good at.** Jev (TypeSafe AI) makes the small, typed decisions on every message: is this urgent, what does the parent want, is this retrieved chunk relevant. It returns probabilities, not text, so the decisions are cheap and testable. Claude does the generative work: turning "durmió de 2 a 4:30" into a validated event, and answering questions from the data or from sources.

## Design decisions

- **Safety is a branch, not a prompt.** The urgency check runs before any generative model and short-circuits to a fixed reply.
- **Typed end to end.** Zod schemas validate Claude's structured output; Jev's SDK infers answer types from the questions.
- **Dependencies injected** into the bot handlers, so routing is unit-tested without network calls.
- **Grounded or silent.** Guidance answers use Claude's native citations over the retrieved passages. An answer that cites nothing is discarded and replaced with "no reliable source, ask your pediatrician".
- **Hybrid retrieval.** Vector search catches paraphrases ("toma" vs "feed"); full text catches exact terms (drug names, ages). Reciprocal rank fusion merges them without comparing incompatible scores.
- **Evals in CI.** Extraction accuracy is scored field by field against labeled messages and fails the PR below 90%.

## Run locally

```sh
cp .env.example .env          # fill in the keys
docker compose up -d          # Postgres + pgvector on :5544
pnpm install
pnpm db:migrate
pnpm ingest                   # embeds guidance/*.md (see guidance/README.md)
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (no network) |
| `pnpm typecheck` | TypeScript |
| `pnpm eval:extraction` | Extraction accuracy, field by field (costs tokens) |
| `pnpm eval:routing` | Router benchmark: Jev vs Claude (costs tokens) |
| `pnpm eval:rag` | Retrieval recall, no-source behavior and faithfulness (costs tokens) |

## Evals

**Router benchmark** (`evals/routing.jsonl`, 32 labeled messages in Spanish and English). The metric that matters most is urgent recall: a missed urgency is the expensive error.

<!-- Paste evals/results/routing.md here after running pnpm eval:routing -->

**RAG** (`evals/rag.jsonl`, labeled against the ingested sources):
- *recall@8 (search)*: the right source is among the hybrid-search candidates.
- *recall (triage)*: it survives Jev's relevance check.
- *no-source correct*: questions no source answers get "ask your pediatrician", not an improvised answer.
- *faithfulness*: Claude as judge lists any claim the cited passages do not support.

## Roadmap

- [x] Weekend 1: log events, ask about your data, Jev router + urgency guardrail
- [x] Weekend 2: RAG over licensed pediatric guidance with citations; "no reliable source" when retrieval finds nothing
- [x] Weekend 3: routing eval + Jev vs LLM router benchmark (accuracy, latency, cost), retrieval recall@k and faithfulness evals
- [ ] Deploy
