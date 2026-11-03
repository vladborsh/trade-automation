-- WD-006 undo. THE DATA IS NOT RESTORABLE: this recreates the STRUCTURE of the 17 dropped tables
-- (and their enum) exactly as they stood after migration 023 — taken with
-- `pg_dump --schema-only --no-owner --no-privileges` from a database migrated to 023 — but every
-- table comes back EMPTY, and the partitioned parents come back with no partitions (nothing
-- maintains them any more). A restore needs the backup taken before 024 ran (RUNBOOK §6).
create type public.playbook_source_mode as enum ('live', 'backtest');

--
--

--
-- Name: candles_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candles_1m (
    venue text NOT NULL,
    market text NOT NULL,
    symbol text NOT NULL,
    open_time timestamp with time zone NOT NULL,
    open numeric NOT NULL,
    high numeric NOT NULL,
    low numeric NOT NULL,
    close numeric NOT NULL,
    volume numeric NOT NULL,
    quote_volume numeric,
    trades integer,
    taker_buy_volume numeric,
    taker_buy_quote_volume numeric,
    source text NOT NULL,
    CONSTRAINT candles_1m_market_check CHECK ((market = ANY (ARRAY['perp'::text, 'spot'::text]))),
    CONSTRAINT candles_1m_source_check CHECK ((source = ANY (ARRAY['ws'::text, 'rest'::text, 'archive'::text])))
)
PARTITION BY RANGE (open_time);

--
-- Name: TABLE candles_1m; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.candles_1m IS 'D4/D12: 1m candles from every venue and market, idempotent on (venue, market, symbol, open_time). D8: the archive backfill writes this same table, tagged source = ''archive''.';

--
-- Name: candles_agg; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candles_agg (
    venue text NOT NULL,
    market text NOT NULL,
    symbol text NOT NULL,
    tf text NOT NULL,
    open_time timestamp with time zone NOT NULL,
    open numeric NOT NULL,
    high numeric NOT NULL,
    low numeric NOT NULL,
    close numeric NOT NULL,
    volume numeric NOT NULL,
    quote_volume numeric,
    trades integer,
    taker_buy_volume numeric,
    taker_buy_quote_volume numeric,
    bars integer NOT NULL,
    complete boolean NOT NULL,
    CONSTRAINT candles_agg_market_check CHECK ((market = ANY (ARRAY['perp'::text, 'spot'::text]))),
    CONSTRAINT candles_agg_tf_check CHECK ((tf = ANY (ARRAY['15m'::text, '1h'::text, '4h'::text, '1d'::text])))
)
PARTITION BY RANGE (open_time);

--
-- Name: COLUMN candles_agg.complete; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.candles_agg.complete IS 'False when the derive job folded a partial window (a gap, or the still-open current bar). Consumers must treat an incomplete bar as missing, never as a smaller one.';

--
-- Name: cooldowns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cooldowns (
    playbook text NOT NULL,
    symbol text NOT NULL,
    source_mode public.playbook_source_mode NOT NULL,
    until timestamp with time zone NOT NULL
);

--
-- Name: fear_greed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fear_greed (
    day date NOT NULL,
    value integer NOT NULL,
    classification text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fear_greed_value_check CHECK (((value >= 0) AND (value <= 100)))
);

--
-- Name: TABLE fear_greed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fear_greed IS 'alternative.me /fng/. Full history since 2018-02-01 is available in one keyless call, so this one IS backfillable — unlike market_cap_global. One row per UTC day; the venue publishes a single value per day.';

--
-- Name: feature_frame_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_frame_versions (
    frame_version integer NOT NULL,
    spec_fingerprint text NOT NULL,
    first_written_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE feature_frame_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.feature_frame_versions IS 'IB-015: the spec fingerprint the first frame of each version was written under. The writer compares the live fingerprint to this on every write and refuses on a mismatch, so changing what a key MEANS without bumping frame_version fails loudly instead of silently producing frames that cannot be compared with the ones already stored.';

--
-- Name: feature_frames; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_frames (
    symbol text NOT NULL,
    tf text NOT NULL,
    close_time timestamp with time zone NOT NULL,
    frame_version integer NOT NULL,
    keys jsonb NOT NULL,
    basis jsonb NOT NULL,
    complete boolean NOT NULL,
    incomplete_reason text[] DEFAULT '{}'::text[] NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    computed_mode text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    amended_at timestamp with time zone,
    amended_keys text[] DEFAULT '{}'::text[] NOT NULL,
    spec_fingerprint text NOT NULL,
    CONSTRAINT feature_frames_computed_mode_check CHECK ((computed_mode = ANY (ARRAY['live'::text, 'backfill'::text]))),
    CONSTRAINT feature_frames_tf_check CHECK ((tf = ANY (ARRAY['15m'::text, '4h'::text])))
)
PARTITION BY RANGE (close_time);

--
-- Name: TABLE feature_frames; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.feature_frames IS 'Design 8.2, append-only by revision. Reads take the LATEST revision of a (symbol, tf, close_time); earlier revisions are the audit trail and a signal references the one it armed on. A frame is written even when keys are not computable: absence would be indistinguishable from the feature pass not running. complete is an index, not a gate — no consumer may arm on it; arming is decided per key.';

--
-- Name: COLUMN feature_frames.frame_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.feature_frames.frame_version IS 'The registry version this frame was computed under, and part of its IDENTITY since IB-053. v1 and v2 frames for one close coexist and are two measurements, not two attempts at one; amendments append revisions INSIDE a version. Reads must scope to a version — comparing across versions compares definitions, not data.';

--
-- Name: COLUMN feature_frames.complete; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.feature_frames.complete IS 'True when every key computed. An INDEX for finding frames with refusals, never a safety mechanism: a consumer decides per key, because a boolean can be forgotten and a typed value cannot.';

--
-- Name: COLUMN feature_frames.computed_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.feature_frames.computed_mode IS 'live = written by the pass at the close; backfill = written by a later run over history. A backfilled frame is better informed than the live one for the same close, because derive healed its buckets in between — mixing the two when learning or backtesting is lookahead. Per revision: a backfill that amends a live frame writes a backfill revision.';

--
-- Name: COLUMN feature_frames.spec_fingerprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.feature_frames.spec_fingerprint IS 'The spec fingerprint the key registry hashed to when this frame was computed. The STRONG identifier — frame_version is a number a human assigns and can forget to change, this is derived from the key set. No default: a writer that omits it must fail loudly rather than claim a spec it may not have run under.';

--
-- Name: feature_value_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_value_conflicts (
    symbol text NOT NULL,
    tf text NOT NULL,
    close_time timestamp with time zone NOT NULL,
    revision integer NOT NULL,
    feature_key text NOT NULL,
    published jsonb NOT NULL,
    recomputed jsonb NOT NULL,
    seen_at timestamp with time zone DEFAULT now() NOT NULL,
    frame_version integer NOT NULL
);

--
-- Name: TABLE feature_value_conflicts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.feature_value_conflicts IS 'IB-015 rule 2: a recompute that would change an already-published feature value. The published value STANDS and the attempt is recorded here. Non-empty means an input changed under us after publication, which is a collector finding, not a feature correction.';

--
-- Name: COLUMN feature_value_conflicts.frame_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.feature_value_conflicts.frame_version IS 'The frame version BOTH sides of the comparison were computed under. Conflicts are within a version only: across versions the definition changed, so a difference is expected and is not a data defect. No default — a writer that omits it must fail rather than claim a version.';

--
-- Name: funding_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funding_settlements (
    venue text NOT NULL,
    symbol text NOT NULL,
    funding_time timestamp with time zone NOT NULL,
    rate double precision NOT NULL,
    mark_price numeric,
    source text NOT NULL,
    CONSTRAINT funding_settlements_source_check CHECK ((source = ANY (ARRAY['ws'::text, 'rest'::text, 'archive'::text])))
);

--
-- Name: gap_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gap_reports (
    day date NOT NULL,
    report jsonb NOT NULL,
    clean boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE gap_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gap_reports IS 'One row per UTC day (IB-011, design §6.2). `clean` is the stage-0 criterion for that day: no missing 1m bars on any symbol or market, no missing 5m OI/LS slots, and no unrepaired mark/liquidation silence longer than WATCHDOG_SILENCE_MIN. Fourteen consecutive true values are what the cluster is accepted on.';

--
-- Name: COLUMN gap_reports.report; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gap_reports.report IS 'The full report object the builder produced, so a later reader can see WHY a day was not clean without re-deriving it from data that has since been repaired.';

--
-- Name: mark_funding_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mark_funding_1m (
    venue text NOT NULL,
    symbol text NOT NULL,
    ts timestamp with time zone NOT NULL,
    mark_price numeric,
    index_price numeric,
    predicted_funding_rate double precision,
    next_funding_time timestamp with time zone,
    source text NOT NULL,
    CONSTRAINT mark_funding_1m_source_check CHECK ((source = ANY (ARRAY['ws'::text, 'rest'::text, 'archive'::text])))
)
PARTITION BY RANGE (ts);

--
-- Name: TABLE mark_funding_1m; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mark_funding_1m IS 'D5: one row per venue/symbol/minute, the last sample in that minute. §3.3: Bybit and OKX mark is sampled per minute only for the signal set; the rest of the universe is settlement-only.';

--
-- Name: market_cap_coin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_cap_coin (
    day date NOT NULL,
    coin text NOT NULL,
    cap_usd numeric,
    price_usd numeric,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE market_cap_coin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_cap_coin IS 'CoinGecko /coins/{id}/market_chart?days=365&interval=daily — 365 days is the free limit (days=max is paid: 401, error 10012, probed 2026-09-28). That limit is a property of the source, not a gap in collection. cap_usd is null when the venue returns a price but no cap.';

--
-- Name: market_cap_global; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_cap_global (
    ts timestamp with time zone NOT NULL,
    total_usd numeric NOT NULL,
    btc_pct double precision,
    eth_pct double precision,
    dominance jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE market_cap_global; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_cap_global IS 'CoinGecko /api/v3/global, every 10 minutes, FORWARD ONLY: the historical endpoint is paid, so this series can never be reconstructed. btc_pct and eth_pct are lifted out of `dominance` for the common query; they are null if the venue omits them, never 0.';

--
-- Name: playbook_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbook_config (
    playbook text NOT NULL,
    version integer NOT NULL,
    params jsonb NOT NULL,
    status text NOT NULL,
    context_gate jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    CONSTRAINT playbook_config_status_check CHECK ((status = ANY (ARRAY['live'::text, 'shadow'::text, 'off'::text])))
);

--
-- Name: playbook_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbook_evaluations (
    playbook text NOT NULL,
    version integer NOT NULL,
    symbol text NOT NULL,
    arm text NOT NULL,
    source_mode public.playbook_source_mode NOT NULL,
    close_time timestamp with time zone NOT NULL,
    frame_revision integer NOT NULL,
    outcome text NOT NULL,
    refusal text,
    gate_status text,
    gate_refusal text,
    exclude_from_comparison boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    frame_version integer NOT NULL,
    CONSTRAINT playbook_evaluations_arm_check CHECK ((arm = ANY (ARRAY['gated'::text, 'unconditional'::text]))),
    CONSTRAINT playbook_evaluations_gate_refusal_check CHECK ((gate_refusal = ANY (ARRAY['calendar_unknown'::text, 'gate_key_unavailable'::text, 'gate_axis_unavailable'::text]))),
    CONSTRAINT playbook_evaluations_gate_status_check CHECK ((gate_status = ANY (ARRAY['pass'::text, 'blocked'::text, 'unavailable'::text]))),
    CONSTRAINT playbook_evaluations_outcome_check CHECK ((outcome = ANY (ARRAY['armed'::text, 'triggered'::text, 'invalidated'::text, 'expired'::text, 'expired_unevaluable'::text, 'declined'::text, 'refused'::text, 'held'::text]))),
    CONSTRAINT playbook_evaluations_refusal_check CHECK ((refusal = ANY (ARRAY['insufficient_features'::text, 'blind_while_armed'::text, 'window_not_contiguous'::text, 'late_detection'::text, 'frame_revision_unavailable'::text])))
)
PARTITION BY RANGE (close_time);

--
-- Name: TABLE playbook_evaluations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.playbook_evaluations IS 'IB-017: one row per playbook x symbol x arm x close, recording what the engine decided and — when it declined to decide — why. Recorded rather than derived: a later recomputation is a reconstruction under code, config and healed buckets that did not exist at the time.';

--
-- Name: COLUMN playbook_evaluations.frame_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.playbook_evaluations.frame_version IS 'The frame version this arm was evaluated against. With frame_revision it identifies exactly one frame row; revision alone stopped doing so when v1 and v2 began to coexist (IB-053). Back-filled to 1 on rows written before v2 frames could exist, after verifying none did.';

--
-- Name: playbook_frame_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbook_frame_pins (
    playbook text NOT NULL,
    symbol text NOT NULL,
    close_time timestamp with time zone NOT NULL,
    source_mode public.playbook_source_mode NOT NULL,
    frame_revision integer NOT NULL,
    frame_version integer NOT NULL,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL
)
PARTITION BY RANGE (close_time);

--
-- Name: TABLE playbook_frame_pins; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.playbook_frame_pins IS 'One frame pin per (playbook, symbol, close, source_mode) — the frame both arms of that close are judged on. It is a TABLE rather than a column on playbook_evaluations because the promise spans arms, and a per-arm column cannot express "all rows for this close agree". An arm READS this; it never decides it.';

--
-- Name: COLUMN playbook_frame_pins.frame_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.playbook_frame_pins.frame_revision IS 'Settled by CONTENT, not by arrival: the lowest (frame_version, frame_revision) offered wins, so two racing writers reach the same pin in either order and a replay is reproducible. See the upsert in playbooks.repo.pinFrame.';

--
-- Name: playbook_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbook_state (
    playbook text NOT NULL,
    symbol text NOT NULL,
    arm text NOT NULL,
    source_mode public.playbook_source_mode NOT NULL,
    state text NOT NULL,
    version integer NOT NULL,
    setup jsonb,
    armed_at timestamp with time zone,
    expires_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT playbook_state_arm_check CHECK ((arm = ANY (ARRAY['gated'::text, 'unconditional'::text]))),
    CONSTRAINT playbook_state_state_check CHECK ((state = ANY (ARRAY['IDLE'::text, 'ARMED'::text, 'TRIGGERED'::text, 'CLOSED'::text])))
);

--
-- Name: TABLE playbook_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.playbook_state IS 'IB-017: current setup state per playbook x symbol x arm x source_mode. TRIGGERED -> CLOSED is written by the tracker (IB-023), not by the engine; until IB-023 exists nothing leaves TRIGGERED and that is deliberate — a timeout here would be an invented number.';

--
-- Name: signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signals (
    id uuid NOT NULL,
    playbook text NOT NULL,
    version integer NOT NULL,
    arm text NOT NULL,
    source_mode public.playbook_source_mode NOT NULL,
    symbol text NOT NULL,
    direction text NOT NULL,
    trigger_ts timestamp with time zone NOT NULL,
    detected_at timestamp with time zone NOT NULL,
    detection_skew_sec integer NOT NULL,
    tf text NOT NULL,
    setup jsonb NOT NULL,
    feature_snapshot jsonb NOT NULL,
    regime jsonb,
    score real,
    vetoes text[] DEFAULT '{}'::text[] NOT NULL,
    status_at_signal text NOT NULL,
    delivered boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT signals_arm_check CHECK ((arm = ANY (ARRAY['gated'::text, 'unconditional'::text]))),
    CONSTRAINT signals_direction_check CHECK ((direction = ANY (ARRAY['long'::text, 'short'::text]))),
    CONSTRAINT signals_tf_check CHECK ((tf = ANY (ARRAY['15m'::text, '4h'::text])))
);

--
-- Name: COLUMN signals.trigger_ts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.signals.trigger_ts IS 'The bar close the trigger fired at, never the instant it was evaluated — see detected_at. D12 keys on this so a late replay of the same bar is idempotent rather than duplicated.';

--
-- Name: candles_1m candles_1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candles_1m
    ADD CONSTRAINT candles_1m_pkey PRIMARY KEY (venue, market, symbol, open_time);

--
-- Name: candles_agg candles_agg_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candles_agg
    ADD CONSTRAINT candles_agg_pkey PRIMARY KEY (venue, market, symbol, tf, open_time);

--
-- Name: cooldowns cooldowns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cooldowns
    ADD CONSTRAINT cooldowns_pkey PRIMARY KEY (playbook, symbol, source_mode);

--
-- Name: fear_greed fear_greed_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fear_greed
    ADD CONSTRAINT fear_greed_pkey PRIMARY KEY (day);

--
-- Name: feature_frame_versions feature_frame_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_frame_versions
    ADD CONSTRAINT feature_frame_versions_pkey PRIMARY KEY (frame_version);

--
-- Name: feature_frames feature_frames_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_frames
    ADD CONSTRAINT feature_frames_pkey PRIMARY KEY (symbol, tf, close_time, frame_version, revision);

--
-- Name: feature_value_conflicts feature_value_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_value_conflicts
    ADD CONSTRAINT feature_value_conflicts_pkey PRIMARY KEY (symbol, tf, close_time, frame_version, revision, feature_key, seen_at);

--
-- Name: funding_settlements funding_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_settlements
    ADD CONSTRAINT funding_settlements_pkey PRIMARY KEY (venue, symbol, funding_time);

--
-- Name: gap_reports gap_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gap_reports
    ADD CONSTRAINT gap_reports_pkey PRIMARY KEY (day);

--
-- Name: mark_funding_1m mark_funding_1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mark_funding_1m
    ADD CONSTRAINT mark_funding_1m_pkey PRIMARY KEY (venue, symbol, ts);

--
-- Name: market_cap_coin market_cap_coin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cap_coin
    ADD CONSTRAINT market_cap_coin_pkey PRIMARY KEY (day, coin);

--
-- Name: market_cap_global market_cap_global_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cap_global
    ADD CONSTRAINT market_cap_global_pkey PRIMARY KEY (ts);

--
-- Name: playbook_config playbook_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_config
    ADD CONSTRAINT playbook_config_pkey PRIMARY KEY (playbook, version);

--
-- Name: playbook_evaluations playbook_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_evaluations
    ADD CONSTRAINT playbook_evaluations_pkey PRIMARY KEY (playbook, symbol, arm, close_time, source_mode);

--
-- Name: playbook_frame_pins playbook_frame_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_frame_pins
    ADD CONSTRAINT playbook_frame_pins_pkey PRIMARY KEY (playbook, symbol, close_time, source_mode);

--
-- Name: playbook_state playbook_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_state
    ADD CONSTRAINT playbook_state_pkey PRIMARY KEY (playbook, symbol, arm, source_mode);

--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (id);

--
-- Name: signals signals_playbook_symbol_trigger_ts_arm_source_mode_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_playbook_symbol_trigger_ts_arm_source_mode_key UNIQUE (playbook, symbol, trigger_ts, arm, source_mode);

--
-- Name: feature_frames_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feature_frames_fingerprint_idx ON ONLY public.feature_frames USING btree (spec_fingerprint, close_time);

--
-- Name: feature_frames_incomplete_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feature_frames_incomplete_idx ON ONLY public.feature_frames USING btree (close_time) WHERE (NOT complete);

--
-- Name: feature_frames_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feature_frames_live_idx ON ONLY public.feature_frames USING btree (close_time) WHERE (computed_mode = 'live'::text);

--
-- Name: gap_reports_clean_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gap_reports_clean_idx ON public.gap_reports USING btree (clean, day DESC);

--
-- Name: market_cap_coin_coin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_cap_coin_coin_idx ON public.market_cap_coin USING btree (coin, day);

--
-- Name: playbook_config_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX playbook_config_status_idx ON public.playbook_config USING btree (playbook, status);

--
-- Name: playbook_evaluations_excluded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX playbook_evaluations_excluded_idx ON ONLY public.playbook_evaluations USING btree (playbook, symbol, close_time) WHERE exclude_from_comparison;

--
-- Name: signals_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX signals_live_idx ON public.signals USING btree (trigger_ts DESC) WHERE (source_mode = 'live'::public.playbook_source_mode);

--
-- Name: signals_symbol_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX signals_symbol_ts_idx ON public.signals USING btree (symbol, trigger_ts DESC);
