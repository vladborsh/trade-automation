import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EconomicEvent } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { CalendarTooltipComponent } from './calendar-tooltip.component';

const CPI: EconomicEvent = {
  id: 'ff:1:2026-10-28', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
  country: 'USD', impact: 'high', scheduledAt: Date.UTC(2026, 9, 28, 12, 30), scheduledDay: '2026-10-28',
  forecast: '0.3%', previous: '0.2%', actual: null, actualSource: null, actualAt: null, status: 'released',
  firstSeenAt: 0, lastSeenAt: 0, revision: 1,
};

describe('CalendarTooltipComponent (IB-060)', () => {
  let fixture: ComponentFixture<CalendarTooltipComponent>;
  let ref: ComponentRef<CalendarTooltipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CalendarTooltipComponent] }).compileComponents();
    TestBed.inject(I18nService).setLangFromUser('en');
    fixture = TestBed.createComponent(CalendarTooltipComponent);
    ref = fixture.componentRef;
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  it('renders nothing off an event line', async () => {
    await fixture.whenStable();
    expect(el().querySelector('.calendar-tooltip')).toBeNull();
  });

  it('shows each event of the bar: title, UTC time, forecast, previous, and a dash for a missing actual', async () => {
    ref.setInput('mark', { time: CPI.scheduledAt / 1000, events: [CPI, { ...CPI, id: 'b', title: 'Core CPI m/m', actual: '0.4%' }] });
    ref.setInput('x', 100);
    fixture.detectChanges();
    await fixture.whenStable();

    const box = el().querySelector<HTMLElement>('.calendar-tooltip');
    expect(box?.style.left).toBe('112px');
    const rows = [...el().querySelectorAll('.event')].map((e) =>
      [...e.querySelectorAll('.title, .time, .figures span')].map((n) => n.textContent?.trim()));
    expect(rows).toEqual([
      ['CPI m/m', '2026-10-28 12:30 UTC', 'forecast 0.3%', 'previous 0.2%', 'actual —'],
      ['Core CPI m/m', '2026-10-28 12:30 UTC', 'forecast 0.3%', 'previous 0.2%', 'actual 0.4%'],
    ]);
  });

  it('IB-067: an upcoming event says how long until it; a past one does not', async () => {
    const soon = { ...CPI, id: 'soon', title: 'NFP', scheduledAt: Date.now() + 2 * 3_600_000 + 15 * 60_000 + 30_000 };
    ref.setInput('mark', { time: 0, events: [CPI, soon] });
    fixture.detectChanges();
    await fixture.whenStable();
    const until = [...el().querySelectorAll('.event')].map((e) => e.querySelector('.until')?.textContent?.trim() ?? null);
    expect(until).toEqual([null, 'in 2 h 16 min']);
  });
});
