import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CollapsedPanelStripComponent } from './collapsed-panel-strip.component';

describe('CollapsedPanelStripComponent', () => {
  let fixture: ComponentFixture<CollapsedPanelStripComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollapsedPanelStripComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CollapsedPanelStripComponent);
    fixture.componentRef.setInput('panelId', 'eth');
    fixture.componentRef.setInput('title', 'ETHUSDT');
    await fixture.whenStable();
  });

  it('renders the title and tags the strip with its panel id', () => {
    const button = fixture.nativeElement.querySelector(
      'button.collapsed-panel-strip',
    ) as HTMLButtonElement;
    expect(button.getAttribute('data-panel-id')).toBe('eth');
    expect(button.textContent).toContain('ETHUSDT');
  });

  it('emits restore when clicked anywhere on the strip', () => {
    let restored = 0;
    fixture.componentInstance.restore.subscribe(() => restored++);
    (fixture.nativeElement.querySelector('.strip-title') as HTMLElement).click();
    expect(restored).toBe(1);
  });
});
