import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CloseSoundSetting } from '../../core/replay/close-sound.setting';

/** T-051 — mutes / unmutes the trade-close sound; remembered per browser. */
@Component({
  selector: 'app-close-sound-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './close-sound-toggle.component.html',
  styleUrl: './close-sound-toggle.component.scss',
})
export class CloseSoundToggleComponent {
  readonly sound = inject(CloseSoundSetting);
}
