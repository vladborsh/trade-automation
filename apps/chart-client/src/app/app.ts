import { Component } from '@angular/core';
import { TerminalShellComponent } from './features/terminal/terminal-shell.component';

@Component({
  imports: [TerminalShellComponent],
  selector: 'app-root',
  template: `<app-terminal-shell />`,
})
export class App {}
