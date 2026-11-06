import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LiqProfileDetailComponent } from './liq-profile-detail.component';
import { LiqProfileStore } from './liq-profile.store';

/**
 * IB-153 — the desktop tooltip of the liquidation profile strip: the hovered band's details, opened to the
 * LEFT of the pointer (the strip is at the pane's right edge). Reads the page's store; nothing without one.
 */
@Component({
  selector: 'app-liq-profile-tip',
  standalone: true,
  imports: [LiqProfileDetailComponent],
  templateUrl: './liq-profile-tip.component.html',
  styleUrl: './liq-profile-tip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqProfileTipComponent {
  readonly store = inject(LiqProfileStore, { optional: true });
}
