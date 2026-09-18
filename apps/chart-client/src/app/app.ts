import { Component } from '@angular/core';
import { TerminalShellComponent } from './features/terminal/terminal-shell.component';

@Component({
  imports: [TerminalShellComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {}
