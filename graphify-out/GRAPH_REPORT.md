# Graph Report - intel-clone  (2026-07-23)

## Corpus Check
- 382 files · ~271,655 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2302 nodes · 4420 edges · 165 communities (132 shown, 33 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0700480e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- router.ts
- marketing-site/src/app/page.tsx
- DashboardClient.tsx
- isSourceEnabled
- PolybolosClient.ts
- ai-engine.ts
- pipeline.test.ts
- reviews/index.ts
- ssrf-guard.ts
- intel/types.ts
- starter-pack/route.ts
- dependencies
- server.js
- cctv/types.ts
- markets/index.ts
- [id]/route.ts
- mappers/index.ts
- analyze.ts
- brightdata/client.ts
- compilerOptions
- automate/route.ts
- dependencies
- compilerOptions
- cctv/route.ts
- mappers.test.ts
- cycle.ts
- agents/runner.ts
- What You Must Do When Invoked
- requireBearerToken
- signHandoffToken
- src/app/page.tsx
- graph.py
- devDependencies
- execute/route.ts
- match.ts
- eval/runner.ts
- actions/route.ts
- ontology/types.ts
- test_moe.py
- getSecret
- markets.test.ts
- moe.py
- ofac/route.ts
- CoveragePanel.tsx
- agents/registry.ts
- marketing/route.ts
- ontology/ingest/route.ts
- resolve/gleif/route.ts
- scan/route.ts
- weather/route.ts
- Agent 1 — Ingest auth hardening + incremental link grounding
- manifest.json
- satellites/route.ts
- kammandor-deals.ts
- resolveExternal.ts
- providers/dataforseo.ts
- get_secret
- 3. Incident playbook
- stealthFetch.ts
- CommandPalette.tsx
- MarketsPanel.tsx
- 3. API keys & data sources
- package.json
- resolve.ts
- harvest.py
- serp/route.ts
- flights/route.ts
- items/route.ts
- scheduler.py
- Agent 2 — Mission C: Action Registry (v1 draft) — report
- connectors/ofac-sdn.ts
- Kammandor Intel — Environment Variable Matrix
- video/package.json
- utah.ts
- health/route.ts
- public/route.ts
- news/route.ts
- ObjectType
- alerts/route.ts
- harvest-delta/route.ts
- graphify reference: extra exports and benchmark
- intel/package.json
- scan/__tests__/route.test.ts
- Kammandor Intel
- monitoring-config/route.ts
- starter-pack/__tests__/route.test.ts
- ErrorBoundary
- bulgaria-sources.ts
- 🦄 EPIC CONVERSATION STARTER — Kammandor INTEL: THE ENGINE ROOM (paste this into the next agent)
- LIVE HEARTBEAT — Python harvest agent: what it is + exact keys to add (2026-07-12)
- MISSION A — Ontology population slice 1: the Kammandor deal graph (2026-07-12)
- Kammandor Intelligence — marketing site
- tools/route.ts
- maritime/route.ts
- GlobalStatusBar.tsx
- SearchBar.tsx
- un-comtrade.ts
- Agent 4 — ACTION EXECUTOR v1 (Mission C completion)
- graphify reference: query, path, explain
- asfinag.ts
- phone/route.ts
- BootSequence.tsx
- IntelFeed.tsx
- sec-edgar.ts
- client.test.ts
- Kammandor Intel Workers
- Agent 3 — Mission B: External entity resolution (GLEIF + OFAC)
- INTEL LIVE STATE — DDL parity snapshot (2026-07-03)
- country-risk/route.ts
- IntelMap.tsx
- LayerPanel.tsx
- LiveMetricsBand.tsx
- VisualModeOverlay.tsx
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- Security Policy
- capabilities/route.ts
- sdk/ingest/route.ts
- sentinel/route.ts
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- marketing-site/src/app/layout.tsx
- enqueue/route.ts
- germany.ts
- italy.ts
- serbia.ts
- fires/route.ts
- infrastructure/route.ts
- live-news/route.ts
- malware/route.ts
- radar/route.ts
- scm-suppliers/route.ts
- sdk/stream/route.ts
- CameraViewer.tsx
- KeyboardShortcuts.tsx
- SharePanel.tsx
- middleware.ts
- extraction-spec.md
- deploy.sh
- eslint.config.mjs
- lucide-react
- next.config.mjs
- marketing-site/postcss.config.mjs
- tailwind.config.ts
- next.config.ts
- next
- react-force-graph-2d
- postcss.config.mjs
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `getSecret()` - 45 edges
2. `resolveTenantFromRequest()` - 33 edges
3. `Entity` - 29 edges
4. `getSecretOrThrow()` - 28 edges
5. `isSourceEnabled()` - 26 edges
6. `stealthFetch()` - 23 edges
7. `ReviewsAdapter` - 22 edges
8. `ReviewsResponse` - 21 edges
9. `ReviewsQueryParams` - 21 edges
10. `MapperResult` - 20 edges

## Surprising Connections (you probably didn't know these)
- `GET()` --indirect_call--> `sparql()`  [INFERRED]
  src/app/api/region-dossier/route.ts → intel/server.js
- `ProductFrame()` --indirect_call--> `signal()`  [INFERRED]
  marketing-site/src/components/ProductFrame.tsx → src/lib/signals/__tests__/alerts.test.ts
- `dedup()` --indirect_call--> `n()`  [INFERRED]
  intel/server.js → src/lib/serp/providers/dataforseo.ts
- `digestAlerts()` --indirect_call--> `h()`  [INFERRED]
  src/app/api/ai/overview/route.ts → src/app/api/signals/harvest-delta/route.ts
- `POST()` --indirect_call--> `headers()`  [INFERRED]
  src/app/api/ontology/crosswalk/sync/route.ts → src/app/api/intel/watchlist/items/route.ts

## Import Cycles
- None detected.

## Communities (165 total, 33 thin omitted)

### Community 0 - "router.ts"
Cohesion: 0.06
Nodes (57): GET(), M, matrixForTier(), ModelStep, providersForTier(), NOTE: this file is the INTERACTIVE (Next.js/Vercel) matrix — `critical` leads, TASK_TIER_MAP, TaskTier (+49 more)

### Community 1 - "marketing-site/src/app/page.tsx"
Cohesion: 0.06
Nodes (49): AuditSection(), CHECKS, TRACE_ROWS, FinalCta(), Footer(), Manifesto(), Comparison(), Governance() (+41 more)

### Community 2 - "DashboardClient.tsx"
Cohesion: 0.07
Nodes (45): DashboardClient(), loadAgentRuns(), loadAlertFeed(), loadEntityCount(), loadOpenAlertSeverities(), loadPendingProposals(), PanelState, restGet() (+37 more)

### Community 3 - "isSourceEnabled"
Cohesion: 0.07
Nodes (40): chFetch(), formatAddress(), GET(), makeAuthHeader(), GET(), GET(), GET(), GET() (+32 more)

### Community 4 - "PolybolosClient.ts"
Cohesion: 0.08
Nodes (29): ALLEGIANCE_COLOR_MAP, ALLEGIANCE_THREAT_MAP, LATTICE_DOMAIN_MAP, LatticeAdapter, LatticeTrack, PolybolosClient, translateCCTV(), translateEarthquakes() (+21 more)

### Community 5 - "ai-engine.ts"
Cohesion: 0.06
Nodes (48): AnalyzeRequestBody, AnalyzeResponse, checkRateLimit(), ErrorResponse, POST(), RateLimitEntry, rateLimitMap, BriefingRequestBody (+40 more)

### Community 6 - "pipeline.test.ts"
Cohesion: 0.09
Nodes (39): ProposedEdit, buildGdeltDocUrl(), clampMaxRecords(), GDELT_EXPECTATIONS, GdeltConnectorDef, GdeltFetchContext, GdeltFetchImpl, gdeltUsableEvent (+31 more)

### Community 7 - "reviews/index.ts"
Cohesion: 0.11
Nodes (28): AggregateScore, ReviewRecord, ReviewsAdapter, ReviewsQueryParams, ReviewsResponse, ApifyAdapter, requireToken(), BrightDataReviewsAdapter (+20 more)

### Community 8 - "ssrf-guard.ts"
Cohesion: 0.11
Nodes (33): GET(), ALLOWED_TYPES, GET(), GET(), GET(), GET(), GET(), GET() (+25 more)

### Community 9 - "intel/types.ts"
Cohesion: 0.09
Nodes (30): Action, LicenceClass, IntelClient, IntelClientOptions, RemoveWatchlistItemsInput, SetWatchlistItemsInput, WatchlistItemInput, WatchlistItemKind (+22 more)

### Community 10 - "starter-pack/route.ts"
Cohesion: 0.07
Nodes (38): DbConfig, getDbConfig(), handleProvision(), POST(), PROVISIONING_ROLES, readCpRoleFromJwt(), StarterPackBody, TenantSourceFlagRow (+30 more)

### Community 11 - "dependencies"
Cohesion: 0.05
Nodes (39): autoprefixer, @fontsource/dm-mono, @fontsource/dm-sans, @fontsource/instrument-serif, dependencies, @fontsource/dm-mono, @fontsource/dm-sans, @fontsource/instrument-serif (+31 more)

### Community 12 - "server.js"
Cohesion: 0.10
Nodes (35): addSanctionsToGraph(), ALLOWED_DOMAINS, ALLOWED_TYPES, app, boot(), dedup(), express, loadSanctions() (+27 more)

### Community 13 - "cctv/types.ts"
Cohesion: 0.07
Nodes (24): fetchAustraliaCameras(), BULGARIA_MANUAL, cameraKey(), fetchBulgariaCameras(), BULGARIA_FWCBG_CAMERAS, CZECHIA_CAMERAS, fetchCzechiaCameras(), fetchFranceCameras() (+16 more)

### Community 14 - "markets/index.ts"
Cohesion: 0.14
Nodes (17): FxRecord, FxResponse, MarketsAdapter, QuoteRecord, QuotesResponse, AlphaVantageAdapter, requireKey(), EcbAdapter (+9 more)

### Community 15 - "[id]/route.ts"
Cohesion: 0.15
Nodes (28): fetchLinks(), fetchProvenance(), fetchVersions(), GET(), notFound(), num(), storeUnreachable(), clampLimit() (+20 more)

### Community 16 - "mappers/index.ts"
Cohesion: 0.14
Nodes (28): makeEntityBase(), makeLinkBase(), mapGleifRecord(), MapperResult, now(), pseudoUuid(), MapperFn, MAPPERS (+20 more)

### Community 17 - "analyze.ts"
Cohesion: 0.12
Nodes (28): RFC-4122, analyzeEntities(), AnalyzeEntitiesInput, buildPrompt(), evaluate(), isUuid(), LLMAnalysisOutput, parseOutput() (+20 more)

### Community 18 - "brightdata/client.ts"
Cohesion: 0.13
Nodes (24): GET(), VALID_TYPES, bearerHeaders(), BrightDataSnapshotStatus, BrightDataTriggerOptions, BrightDataTriggerResult, fetchSnapshotResults(), pollSnapshot() (+16 more)

### Community 19 - "compilerOptions"
Cohesion: 0.07
Nodes (29): marketing-site, **/*.mts, .next/dev/types/**/*.ts, compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules (+21 more)

### Community 20 - "automate/route.ts"
Cohesion: 0.14
Nodes (27): DbConfig, fetchAllTenantWatchlists(), fetchRecentAlerts(), GET(), getDbConfig(), governedPropose(), handleAutomate(), insertAgentRun() (+19 more)

### Community 21 - "dependencies"
Cohesion: 0.07
Nodes (29): @google/generative-ai, google-libphonenumber, hls.js, maplibre-gl, dependencies, framer-motion, @google/generative-ai, google-libphonenumber (+21 more)

### Community 22 - "compilerOptions"
Cohesion: 0.07
Nodes (27): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+19 more)

### Community 23 - "cctv/route.ts"
Cohesion: 0.11
Nodes (20): fetchAsfinagCameras(), fetchFinlandCameras(), fetchHongKongCameras(), HK_CAMERAS, fetchJapanCameras(), JAPAN_CAMERAS, fetchAsiaCameras(), fetchCanadaCameras() (+12 more)

### Community 24 - "mappers.test.ts"
Cohesion: 0.11
Nodes (24): RFC-2822, makeEntityBase(), makeLinkBase(), mapCompaniesHouseResponse(), now(), pseudoUuid(), makeEntityBase(), mapGdeltEvent() (+16 more)

### Community 25 - "cycle.ts"
Cohesion: 0.12
Nodes (21): FAKE_SUMMARY, AgentRunRecord, AutomateCycleDeps, CycleFailure, CyclePipelineStatus, CyclePipelineSummary, CycleStage, CycleSummary (+13 more)

### Community 26 - "agents/runner.ts"
Cohesion: 0.13
Nodes (22): AgentRunContext, AgentRunDeps, errorMessage(), runAgent(), summariseResult(), wrapBinding(), wrapTool(), double (+14 more)

### Community 27 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 28 - "requireBearerToken"
Cohesion: 0.17
Nodes (15): POST(), authenticateIngestRequest(), extractErrorMessage(), POST(), extractErrorMessage(), POST(), authenticateResolveRequest(), authenticateScreenRequest() (+7 more)

### Community 29 - "signHandoffToken"
Cohesion: 0.12
Nodes (14): ENTITY_ROW, makeReq(), NOTE: entity_provenance must be matched BEFORE entity ('/rest/v1/entity', StubOpts, RecordedCall, tokenised(), makeRequest(), base64UrlDecodeToString() (+6 more)

### Community 30 - "src/app/page.tsx"
Cohesion: 0.10
Nodes (17): CameraViewer, Dashboard(), EntityGraphPanel, getYouTubeWatchUrl(), IntelMap, LayerPanel, OsintPanel, NOTE: monitoringConfig is fetched and stored here but not yet consumed (+9 more)

### Community 31 - "graph.py"
Cohesion: 0.14
Nodes (23): _build_graph(), get_graph(), KINTEL Workers — LangGraph Governed-Analysis Graph  Governance boundary (enforce, Return the compiled graph, building it on first call., Build and compile the LangGraph analysis graph.     Lazy-imports langgraph so th, Entity, Link, _new_id() (+15 more)

### Community 32 - "devDependencies"
Cohesion: 0.09
Nodes (23): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/google-libphonenumber (+15 more)

### Community 33 - "execute/route.ts"
Cohesion: 0.15
Nodes (18): ActionRow, AlertInsert, AlertSeverity, ALLOWED_SEVERITIES, clampLimit(), DbConfig, defaultProfileHeaders(), getDbConfig() (+10 more)

### Community 34 - "match.ts"
Cohesion: 0.14
Nodes (17): AutomateTenant, SignalsMatchInput, SignalsMatchOutcome, buildRationale(), CATEGORIES, CATEGORY_LABEL, classify(), containsWholeWord() (+9 more)

### Community 35 - "eval/runner.ts"
Cohesion: 0.16
Nodes (12): gateOrThrow(), persistRun(), runSuite(), entityResolutionSuite, MergePair, signalsMatchSuite, EvalCaseFailure, EvalRunInsert (+4 more)

### Community 36 - "actions/route.ts"
Cohesion: 0.20
Nodes (18): clampLimit(), DbConfig, GET(), getDbConfig(), intelHeaders(), isUuid(), POST(), PostBody (+10 more)

### Community 37 - "ontology/types.ts"
Cohesion: 0.11
Nodes (18): baseEdit(), createLinkEdit(), EXPECTED_ENTITY_TYPES, EXPECTED_LINK_TYPE_KEYS, CompanyNumber, ENTITY_TYPES, GeographicPoint, IMO (+10 more)

### Community 38 - "test_moe.py"
Cohesion: 0.14
Nodes (20): Any, Run the governed analysis graph.     Returns {narrative, proposed_edit_ids, erro, run_analysis(), providers_for_tier(), Back-compat: ordered unique provider names derived from the matrix., tier_for_task(), KINTEL Workers — MoE unit tests Key-free: no network calls, no API keys required, Governance test: proposal helpers must NOT call any DB client.     They return p (+12 more)

### Community 39 - "getSecret"
Cohesion: 0.17
Nodes (12): GET(), Row, Body, cleanTerms(), db(), GET(), POST(), SCOPES (+4 more)

### Community 40 - "markets.test.ts"
Cohesion: 0.14
Nodes (13): makeEntityBase(), mapMarketsInstrument(), now(), pseudoUuid(), makeMarketsConnector(), MARKETS_EXPECTATIONS, MarketsEnv, MarketsFetchImpl (+5 more)

### Community 41 - "moe.py"
Cohesion: 0.15
Nodes (17): Exception, _fetch_from_vault(), get_secret_or_raise(), model_id(), KINTEL Workers — Config & Secrets Resolver Mirrors src/lib/secrets.ts  Resolutio, Return the model ID for a provider from env.     Env var: AI_MODEL_ANTHROPIC, AI, Hit the Supabase Vault RPC intel_get_secret.     Returns the secret string or No, Resolve a secret or raise ValueError with a clear message.     Use in code paths (+9 more)

### Community 42 - "ofac/route.ts"
Cohesion: 0.17
Nodes (17): AlertRow, AuthErr, AuthOk, CRITICAL_SEVERITY, DbConfig, fetchOpenAlertHeadlines(), fetchSdnBatch(), fetchTenantEntities() (+9 more)

### Community 43 - "CoveragePanel.tsx"
Cohesion: 0.13
Nodes (14): ACRONYMS, CategoryGroup, CoverageGovernance, CoveragePanel(), CoverageResponse, CoverageSource, CoverageTool, humaniseCategory() (+6 more)

### Community 44 - "agents/registry.ts"
Cohesion: 0.21
Nodes (13): AGENT_REGISTRY, analystAgent, AnalystTools, AnalyzeFn, buildAnalystAgent(), resolverAgent, ResolverTools, watcherAgent (+5 more)

### Community 45 - "marketing/route.ts"
Cohesion: 0.32
Nodes (12): Db, isUrl(), loadSubjects(), POST(), svc(), WatcherTools, dedupeKey(), toAlertRows() (+4 more)

### Community 46 - "ontology/ingest/route.ts"
Cohesion: 0.19
Nodes (13): fetchGleifRecords(), fetchKammandorDealsRecords(), fetchOfacRecords(), fetchRecordsForSource(), FetchRecordsResult, fetchUnComtradeRecords(), fetchWorldBankRecords(), IngestAuthErr (+5 more)

### Community 47 - "resolve/gleif/route.ts"
Cohesion: 0.18
Nodes (15): AuthErr, AuthOk, CandidateEntity, DbConfig, fetchAlreadyPendingIds(), fetchCandidateEntities(), GleifQueryErr, GleifQueryOk (+7 more)

### Community 48 - "scan/route.ts"
Cohesion: 0.23
Nodes (15): DbConfig, fetchRecentAlertKeys(), fetchTenantWatchlist(), getDbConfig(), handleScan(), insertAlerts(), InsertResult, normaliseWatchlistRow() (+7 more)

### Community 49 - "weather/route.ts"
Cohesion: 0.17
Nodes (15): averageCoordinates(), EonetEvent, EonetResponse, GDACS_TYPE_MAP, GET(), getGdacsTag(), getRepresentativePoint(), normalizeGdacsSeverity() (+7 more)

### Community 50 - "Agent 1 — Ingest auth hardening + incremental link grounding"
Cohesion: 0.13
Nodes (14): Agent 1 — Ingest auth hardening + incremental link grounding, Honest list of uncertainties / things the orchestrator should double-check, Scope note (unrelated pre-existing dirty state), `src/app/api/ontology/ingest/route.ts`, `src/app/api/ontology/ingest/route.ts` — `fetchKammandorDealsRecords`, `src/app/api/ontology/ingest/__tests__/route.test.ts`, `src/lib/ontology/authRpc.ts`, `src/lib/ontology/ingest.ts` (+6 more)

### Community 51 - "manifest.json"
Cohesion: 0.13
Nodes (14): background_color, categories, description, display, icons, name, orientation, short_name (+6 more)

### Community 52 - "satellites/route.ts"
Cohesion: 0.19
Nodes (13): CACHE_DIR, CACHE_FILE, CELESTRAK_GROUPS, classifySatellite(), diskCache, fetchCelesTrakGroup(), GET(), globalCachedSats (+5 more)

### Community 53 - "kammandor-deals.ts"
Cohesion: 0.22
Nodes (12): asJurisdictionCode(), asText(), asUuid(), CompanyRow, ContactRow, DealRow, KammandorDealGraphRecord, linkEvidencePath() (+4 more)

### Community 54 - "resolveExternal.ts"
Cohesion: 0.27
Nodes (12): normaliseCanonicalName(), extractGleifLegalName(), extractGleifLei(), GleifMatch, GleifMatchOutcome, GleifRecordLike, ofacNameMatches(), pickUniqueGleifMatch() (+4 more)

### Community 55 - "providers/dataforseo.ts"
Cohesion: 0.25
Nodes (10): SerpAdapter, SerpItem, SerpKind, SerpQueryParams, SerpResponse, authHeader(), collect(), DataForSeoSerpAdapter (+2 more)

### Community 56 - "get_secret"
Cohesion: 0.23
Nodes (14): get_secret(), Resolve a secret by name.     Returns the value string, or None if not found., analyze(), AnalyzeRequest, AnalyzeResponse, harvest(), HarvestRequest, health() (+6 more)

### Community 57 - "3. Incident playbook"
Cohesion: 0.14
Nodes (13): 1. Deploy topology — what runs where, 2.1 What protects what, 2.2 Restore drill — prove the rebuild actually works, 2. Backup / restore posture, 3.1 Cron silent (no alerts, no traces appearing), 3.2 Alert flood (too many rows landing in `intelligence_alerts`), 3.3 Bad batch held (connector data failed expectations), 3.4 Bad deploy — rollback (+5 more)

### Community 58 - "stealthFetch.ts"
Cohesion: 0.20
Nodes (11): ConflictEvent, ConflictZone, fetchAllLiveConflictData(), GET(), KNOWN_CONFLICTS, generateResidentialIP(), IP_POOLS, randomInt() (+3 more)

### Community 59 - "CommandPalette.tsx"
Cohesion: 0.20
Nodes (13): ACRONYMS, CommandItem, CommandPalette(), FEATURED_LAYERS, GROUP_ORDER, GroupName, humanise(), isEditableTarget() (+5 more)

### Community 60 - "MarketsPanel.tsx"
Cohesion: 0.15
Nodes (6): AiOverviewProps, OverviewResult, LiveAlertsProps, RISK_COLORS, MarketsPanelProps, SECTIONS

### Community 61 - "3. API keys & data sources"
Cohesion: 0.17
Nodes (11): 1. Docker Compose (recommended), 2. CasaOS, 3. API keys & data sources, Image details, Keyless sources (no configuration needed), Optional keys (reserved / for higher rate limits), Optional runtime overrides, Plain `docker run` (+3 more)

### Community 62 - "package.json"
Cohesion: 0.17
Nodes (11): name, private, scripts, build, dev, lint, start, test (+3 more)

### Community 63 - "resolve.ts"
Cohesion: 0.27
Nodes (9): buildMergeProposal(), dedupeEntities(), findMergeCandidates(), identifierValue(), LEGAL_SUFFIXES, orderPair(), PROMOTED_IDENTIFIERS, PromotedIdentifier (+1 more)

### Community 64 - "harvest.py"
Cohesion: 0.33
Nodes (11): _bd_collect(), harvest_tenant(), _load_subject_urls(), _map_item(), _push_delta(), Any, KINTEL Workers — live-heartbeat harvest agent (net-new signals for PULSE + Kamma, Run the live-heartbeat harvest for one tenant. Never raises. (+3 more)

### Community 65 - "serp/route.ts"
Cohesion: 0.27
Nodes (9): Db, DeltaItem, isUrl(), KINDS, loadSubjects(), POST(), svc(), toDeltaItem() (+1 more)

### Community 66 - "flights/route.ts"
Cohesion: 0.33
Nodes (10): aggregateJamming(), classifyFlight(), fetchRegionFrom(), GET(), getOpenSkyToken(), HELI_TYPES, ingestAc(), MILITARY_INDICATORS (+2 more)

### Community 67 - "items/route.ts"
Cohesion: 0.38
Nodes (10): db(), DELETE(), GET(), headers(), InItem, KINDS, POST(), scopeRef() (+2 more)

### Community 68 - "scheduler.py"
Cohesion: 0.27
Nodes (10): _list_tenants(), main(), _push_execute(), _push_serp(), Any, KINTEL Workers — heartbeat scheduler (Render cron entry point).  Run periodicall, Distinct tenant_ids that have at least one active watchlist item (any kind)., Ask the engine to run the DataForSEO SERP harvest for this tenant. (+2 more)

### Community 69 - "Agent 2 — Mission C: Action Registry (v1 draft) — report"
Cohesion: 0.20
Nodes (9): A. migrations/intel/0032_action_registry.sql (new, draft only), Agent 2 — Mission C: Action Registry (v1 draft) — report, B. src/lib/ontology/actions.ts (new), C. src/lib/ontology/__tests__/actions.test.ts (new), change_log decision (the flagged uncertainty), Concerns / open decisions for the orchestrator, D. SDK: client.ts / types.ts / index.ts / route.ts, One type-safety fix worth flagging (+1 more)

### Community 70 - "connectors/ofac-sdn.ts"
Cohesion: 0.29
Nodes (6): RFC-4180, createOfacSdnConnector(), OFAC_EXPECTATIONS, OfacFetchImpl, ofacUsableIdentity, parseCsv()

### Community 71 - "Kammandor Intel — Environment Variable Matrix"
Cohesion: 0.20
Nodes (9): 1. Core data store, 2. Security & tenancy (★ reported by /api/health), 3. Pipeline connectors (governed ingest), 4. Market-data providers (dashboard/map layer), 5. Reviews & social providers, 6. AI routing (Next.js router + Render Python workers), 7. Service wiring & feature flags, 8. Platform-set & build/test (+1 more)

### Community 72 - "video/package.json"
Cohesion: 0.20
Nodes (9): hyperframes, description, devDependencies, hyperframes, name, private, scripts, preview (+1 more)

### Community 73 - "utah.ts"
Cohesion: 0.42
Nodes (8): buildQuery(), fetchPage(), fetchUtahCameras(), mapRecord(), parseWkt(), sampleRecord, UTAH_BOUNDS, UtahCameraRecord

### Community 74 - "health/route.ts"
Cohesion: 0.33
Nodes (7): CheckState, GET(), HealthBody, isNonEmpty(), probeDatabase(), probeHandoffSecret(), SecretState

### Community 75 - "public/route.ts"
Cohesion: 0.36
Nodes (9): buildMetrics(), fetchJson(), GET(), globalStore, num(), pick(), PublicMetrics, REGISTRY_FALLBACK (+1 more)

### Community 76 - "news/route.ts"
Cohesion: 0.29
Nodes (9): FALLBACK_FEEDS, findCoords(), GET(), KEYWORD_COORDS, parseRSSItems(), parseTelegramHTML(), RISK_KEYWORDS, scoreRisk() (+1 more)

### Community 77 - "ObjectType"
Cohesion: 0.29
Nodes (9): ValidatedQuery, LINK_TYPES, LinkTypeMeta, OBJECT_TYPES, ObjectTypeMeta, LinkType, ObjectType, GraphTraverseStep (+1 more)

### Community 78 - "alerts/route.ts"
Cohesion: 0.29
Nodes (7): clampLimit(), GET(), storeUnreachable(), toAlertRecord(), ALERT_ROW, tokenised(), AlertRecord

### Community 79 - "harvest-delta/route.ts"
Cohesion: 0.29
Nodes (9): attrStr(), buildAlert(), CleanItem, Db, h(), Kind, KINDS, POST() (+1 more)

### Community 80 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 81 - "intel/package.json"
Cohesion: 0.22
Nodes (8): express, dependencies, express, name, private, scripts, start, version

### Community 82 - "scan/__tests__/route.test.ts"
Cohesion: 0.22
Nodes (5): POST(), AUTH, RecordedCall, tokenPath(), WATCHLIST_ROW

### Community 83 - "Kammandor Intel"
Cohesion: 0.25
Nodes (7): Environment Variables, Getting Started, Kammandor Intel, Key Capabilities, Licence, Overview, Tech Stack

### Community 84 - "monitoring-config/route.ts"
Cohesion: 0.36
Nodes (5): FetchConfigResult, fetchMonitoringConfig(), GET(), MonitoringConfigResponse, normaliseRow()

### Community 85 - "starter-pack/__tests__/route.test.ts"
Cohesion: 0.29
Nodes (5): adminHeaders(), fakeSupabaseJwt(), RecordedCall, tokenPath(), VALID_AUTH_MODES

### Community 86 - "ErrorBoundary"
Cohesion: 0.25
Nodes (3): ErrorBoundary, Props, State

### Community 87 - "bulgaria-sources.ts"
Cohesion: 0.25
Nodes (5): BALKANS_BBOX, BG_NEWS_FEEDS, BULGARIA_BBOX, DEFAULT_MAP_CENTER, NigggEarthquake

### Community 88 - "🦄 EPIC CONVERSATION STARTER — Kammandor INTEL: THE ENGINE ROOM (paste this into the next agent)"
Cohesion: 0.29
Nodes (6): 0. NON-NEGOTIABLE FIRST ACTIONS (in this order), 1. WHAT WAS SHIPPED 2026-07-12/13 (build ON it — read `docs/handoff/` + `_agent_reports/` in the repo), 2. THE LAWS (never violate), 3. YOUR MISSION QUEUE (RALPH order), 4. ENVIRONMENT TRAPS (verbatim lessons), 🦄 EPIC CONVERSATION STARTER — Kammandor INTEL: THE ENGINE ROOM (paste this into the next agent)

### Community 89 - "LIVE HEARTBEAT — Python harvest agent: what it is + exact keys to add (2026-07-12)"
Cohesion: 0.29
Nodes (6): Bright Data dataset IDs — the `gd_…` id from each scraper's `</> Scraper API` page, How to run / verify, KEYS TO ADD — Render (both the `web` and the `cron` service), LIVE HEARTBEAT — Python harvest agent: what it is + exact keys to add (2026-07-12), SERP layer added (2026-07-12, commit fb6085b — live, verified), What now exists (live on push to `master`)

### Community 90 - "MISSION A — Ontology population slice 1: the Kammandor deal graph (2026-07-12)"
Cohesion: 0.29
Nodes (6): Code (additive; zero behaviour change for existing mappers), How to verify (and what was verified live), Known limitations / follow-ups (honest list), MISSION A — Ontology population slice 1: the Kammandor deal graph (2026-07-12), What this slice does, Why two migrations were needed (root cause found + fixed)

### Community 91 - "Kammandor Intelligence — marketing site"
Cohesion: 0.29
Nodes (6): Deploy on Vercel, House rules for edits, Kammandor Intelligence — marketing site, Run locally, Structure, The brand film (HyperFrames)

### Community 92 - "tools/route.ts"
Cohesion: 0.33
Nodes (6): GET(), liveSources(), SourceRow, ToolAuth, ToolDef, TOOLS

### Community 93 - "maritime/route.ts"
Cohesion: 0.33
Nodes (5): CHOKEPOINTS, fetchVesselApiFallback(), GET(), globalForAis, PORTS

### Community 94 - "GlobalStatusBar.tsx"
Cohesion: 0.33
Nodes (5): CryptoPrice, CyberThreat, Earthquake, formatPrice(), GlobalStatusBar()

### Community 95 - "SearchBar.tsx"
Cohesion: 0.43
Nodes (6): formatLabel(), getResultIcon(), getZoomForType(), SearchBar(), SearchBarProps, SearchResult

### Community 96 - "un-comtrade.ts"
Cohesion: 0.67
Nodes (6): jurisdictionEntity(), makeEntityBase(), makeLinkBase(), mapUnComtradeFlow(), now(), pseudoUuid()

### Community 97 - "Agent 4 — ACTION EXECUTOR v1 (Mission C completion)"
Cohesion: 0.33
Nodes (5): Agent 4 — ACTION EXECUTOR v1 (Mission C completion), Delivered, Key deviation from the brief, verified and documented, Uncertainties for the orchestrator to confirm, Verification evidence

### Community 98 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 99 - "asfinag.ts"
Cohesion: 0.40
Nodes (5): ASFINAG_HEADERS, AsfinagWebcam, CctvCamera, fetchFreshAsfinagCameras(), toAsfinagCamera()

### Community 100 - "phone/route.ts"
Cohesion: 0.40
Nodes (5): GET(), NANP_COORDS, phoneUtil, REGION_COORDS, REGION_NAMES

### Community 101 - "BootSequence.tsx"
Cohesion: 0.33
Nodes (5): BootSequence(), Chip, CHIPS, Decision, STATUS_MESSAGES

### Community 102 - "IntelFeed.tsx"
Cohesion: 0.53
Nodes (5): getRiskClass(), getRiskLabel(), IntelFeed(), IntelFeedProps, timeAgo()

### Community 103 - "sec-edgar.ts"
Cohesion: 0.73
Nodes (5): makeEntityBase(), makeLinkBase(), mapSecEdgarFiling(), now(), pseudoUuid()

### Community 104 - "client.test.ts"
Cohesion: 0.33
Nodes (3): createIntelClient(), IntelApiError, Recorded

### Community 105 - "Kammandor Intel Workers"
Cohesion: 0.33
Nodes (5): Architecture note, Deploy on Render, Kammandor Intel Workers, Local development, Tests

### Community 106 - "Agent 3 — Mission B: External entity resolution (GLEIF + OFAC)"
Cohesion: 0.40
Nodes (4): Agent 3 — Mission B: External entity resolution (GLEIF + OFAC), Files created (all new, additive only — no existing file modified), Uncertainties / things a reviewer should double-check, Verification

### Community 107 - "INTEL LIVE STATE — DDL parity snapshot (2026-07-03)"
Cohesion: 0.40
Nodes (4): INTEL LIVE STATE — DDL parity snapshot (2026-07-03), Live columns (information_schema, pre-0013), Live migration names → repo files, Live RLS policies (pg_policies, schema `intel`)

### Community 108 - "country-risk/route.ts"
Cohesion: 0.50
Nodes (4): EXCHANGES, GET(), isExchangeOpen(), RISK_FACTORS

### Community 109 - "IntelMap.tsx"
Cohesion: 0.50
Nodes (4): computeSolarTerminator(), EMPTY_FC, IntelMap(), IntelMapProps

### Community 111 - "LiveMetricsBand.tsx"
Cohesion: 0.50
Nodes (4): compact(), LIVE_LABELS, LiveMetricsBand(), PublicMetrics

### Community 112 - "VisualModeOverlay.tsx"
Cohesion: 0.50
Nodes (4): LABEL, MODES, VisualModeOverlay(), VMode

### Community 113 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 114 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 115 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 116 - "Security Policy"
Cohesion: 0.50
Nodes (3): Reporting a Vulnerability, Responsible Usage, Security Policy

### Community 119 - "sentinel/route.ts"
Cohesion: 0.83
Nodes (3): estimateArea(), formatScene(), GET()

## Knowledge Gaps
- **711 isolated node(s):** `deploy.sh script`, `eslintConfig`, `name`, `version`, `private` (+706 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSecret()` connect `getSecret` to `router.ts`, `serp/route.ts`, `items/route.ts`, `actions/route.ts`, `isSourceEnabled`, `reviews/index.ts`, `health/route.ts`, `starter-pack/route.ts`, `marketing/route.ts`, `ontology/ingest/route.ts`, `[id]/route.ts`, `alerts/route.ts`, `harvest-delta/route.ts`, `scan/route.ts`, `monitoring-config/route.ts`, `providers/dataforseo.ts`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `Expectation` connect `pipeline.test.ts` to `markets.test.ts`, `connectors/ofac-sdn.ts`, `src/app/page.tsx`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **What connects `deploy.sh script`, `eslintConfig`, `name` to the rest of the system?**
  _711 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `router.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06185919343814081 - nodes in this community are weakly interconnected._
- **Should `marketing-site/src/app/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06368011847463902 - nodes in this community are weakly interconnected._
- **Should `DashboardClient.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07422559906487435 - nodes in this community are weakly interconnected._
- **Should `isSourceEnabled` be split into smaller, more focused modules?**
  _Cohesion score 0.07127882599580712 - nodes in this community are weakly interconnected._