import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ViewStore } from '../../core/state/view.store';

/**
 * §7 D9 — a two-button segmented control for the top-level charts⇄calendar
 * view switch. Not a router link: there is no router in this app.
 */
@Component({
  selector: 'app-view-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './view-switcher.component.html',
  styleUrl: './view-switcher.component.scss',
})
export class ViewSwitcherComponent {
  constructor(readonly view: ViewStore) {}
}
