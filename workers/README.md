# Kammandor Intel Workers

Python + FastAPI + LangGraph service — the Render half of the split architecture.

```
Next.js (Vercel)   →  POST /analyze  →  Python Workers (Render)
                                                  │
                                        LangGraph graph runs
                                                  │
                                       intel.proposed_edit (Supabase)
                                                  │
                                        Analyst approves in UI
                                                  │
                                       intel.entity / intel.link updated
```

## Architecture note

**Governance boundary**: the LLM proposes; humans approve; the application layer applies.

- The graph's `retrieve` node reads from `intel.entity` (read-only).
- The `reason` node synthesises a narrative via the MoE router.
- The `propose` node builds `ProposedEdit` dicts (no DB writes).
- The `persist` node is the **only writer** — it inserts rows into `intel.proposed_edit` with `status='pending'`.
- An analyst approves in the Kammandor UI → application job applies to `intel.entity`/`intel.link`.

## Deploy on Render

1. Connect your GitHub repo to Render.
2. Create a new **Web Service**.
3. Set **Root Directory** to `workers`.
4. Render detects `render.yaml` automatically.
5. Set the following environment variables in the Render dashboard:

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service-role key (not anon) |
| `ANTHROPIC_API_KEY` | Recommended | Critical-tier primary provider |
| `ZHIPU_API_KEY` | Recommended | Critical-tier fallback |
| `OPENAI_API_KEY` | Optional | Fast-tier primary |
| `GOOGLE_API_KEY` | Optional | Fast/balanced fallback |
| `AI_MODEL_ANTHROPIC` | Optional | Defaults to `claude-opus-4-5` |
| `AI_MODEL_OPENAI` | Optional | Defaults to `gpt-4o-mini` |
| `AI_MODEL_GOOGLE` | Optional | Defaults to `gemini-1.5-flash` |
| `AI_MODEL_ZHIPU` | Optional | Defaults to `glm-4-flash` |

## Local development

```bash
cd workers
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/health`

## Tests

```bash
cd workers
pip install pytest pytest-asyncio
python -m pytest tests -q
```
