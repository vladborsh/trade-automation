import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { BacktestInstrument, InstrumentId, Timeframe } from '@trade-automation/contracts';
import { BacktestClient } from '../../core/api/backtest.client';
import { RestClient } from '../../core/api/rest.client';
import { AppNavComponent } from '../nav/app-nav.component';
import { groupByCurrency } from './instrument-groups';
import { InstrumentPickerComponent } from './instrument-picker.component';
import {
  DEFAULT_RISK_PCT,
  commonCoverage,
  defaultPeriod,
  hasErrors,
  periodFits,
  sessionCurrencies,
  toCreateRequest,
  validateSessionForm,
  type SessionFormFields,
} from './session-form.validation';
import { fromUtcInputValue, toUtcInputValue } from './session-format';
import { buildSessionLayout, presetOptions, type PresetOption } from './session-layout';
import { createSessionErrorMessage, loadErrorMessage } from './session-messages';

/** §7.2, decision 31: sessions may be created on all six timeframes. */
const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

/** backtest-app-system-design.md §2.3, §7.2 — `/sessions/new`. */
@Component({
  selector: 'app-session-create',
  standalone: true,
  imports: [AppNavComponent, InstrumentPickerComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-create.component.html',
  styleUrl: './session-create.component.scss',
})
export class SessionCreateComponent implements OnInit {
  private readonly backtest = inject(BacktestClient);
  private readonly rest = inject(RestClient);
  private readonly router = inject(Router);

  readonly timeframes = TIMEFRAMES;
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly submitError = signal<string | null>(null);
  readonly busy = signal(false);
  private readonly submitted = signal(false);

  private readonly instruments = signal<BacktestInstrument[]>([]);
  readonly presets = signal<PresetOption[]>([]);
  readonly presetId = signal<string | null>(null);

  readonly form = signal<SessionFormFields>({
    name: '',
    instruments: [],
    timeframe: '15m',
    periodFromMs: null,
    periodToMs: null,
    initialBalance: 10_000,
    defaultRiskPct: DEFAULT_RISK_PCT,
    costsEnabled: true,
    commissionPct: 0.04,
    spread: 0,
    skipWeekends: true,
  });

  readonly catalogue = computed(() => new Map<InstrumentId, BacktestInstrument>(this.instruments().map((i) => [i.id, i])));
  readonly groups = computed(() => groupByCurrency(this.instruments()));
  readonly preset = computed(() => this.presets().find((p) => p.id === this.presetId()) ?? null);
  readonly common = computed(() => commonCoverage(this.form().instruments, this.catalogue()));
  readonly currency = computed(() => sessionCurrencies(this.form().instruments, this.catalogue()).join('/') || '—');
  readonly errors = computed(() => validateSessionForm(this.form(), this.catalogue()));
  /** Field errors appear after the first submit, except the instrument ones (a mix is flagged at once). */
  readonly shown = computed(() => (this.submitted() ? this.errors() : { instruments: this.errors().instruments }));
  /** A mixed-currency (or otherwise invalid) selection cannot be submitted at all. */
  readonly blocked = computed(() => this.busy() || this.errors().instruments !== undefined);

  readonly toInput = toUtcInputValue;

  async ngOnInit(): Promise<void> {
    try {
      const [instruments, layouts] = await Promise.all([this.backtest.getInstruments(), this.rest.getLayouts()]);
      this.instruments.set(instruments);
      this.presets.set(presetOptions(layouts, new Set(instruments.filter((i) => i.coverage).map((i) => i.id))));
    } catch (err) {
      this.loadError.set(loadErrorMessage(err, 'instruments'));
    } finally {
      this.loading.set(false);
    }
  }

  set<K extends keyof SessionFormFields>(key: K, value: SessionFormFields[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  /** `<input type="number">` → number, or null when empty. */
  setNumber(key: 'initialBalance' | 'defaultRiskPct' | 'commissionPct' | 'spread', raw: string): void {
    this.set(key, raw.trim() === '' ? null : Number(raw));
  }

  setPeriod(key: 'periodFromMs' | 'periodToMs', raw: string): void {
    this.set(key, fromUtcInputValue(raw));
  }

  setTimeframe(raw: string): void {
    this.set('timeframe', raw as Timeframe);
  }

  selectInstruments(instruments: InstrumentId[]): void {
    this.set('instruments', instruments);
    const common = commonCoverage(instruments, this.catalogue());
    const { periodFromMs, periodToMs } = this.form();
    // keep a period the user set while it still fits; otherwise move it inside the new coverage
    if (common && !periodFits(periodFromMs, periodToMs, common)) {
      const period = defaultPeriod(common);
      this.form.update((f) => ({ ...f, periodFromMs: period.from, periodToMs: period.to }));
    }
  }

  choosePreset(id: string): void {
    const preset = this.presets().find((p) => p.id === id && !p.disabledReason) ?? null;
    this.presetId.set(preset?.id ?? null);
    if (preset) this.selectInstruments([...new Set(preset.panels.map((p) => p.instrument))]);
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.blocked() || hasErrors(this.errors())) return;
    this.busy.set(true);
    this.submitError.set(null);
    try {
      const form = this.form();
      const session = await this.backtest.createSession(toCreateRequest(form, buildSessionLayout(form.instruments, this.preset())));
      await this.router.navigateByUrl(`/sessions/${session.id}`); // T-040: straight into the new session's workspace
    } catch (err) {
      this.submitError.set(createSessionErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
