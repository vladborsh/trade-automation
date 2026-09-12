import { Plot } from '../interfaces/plot';

export class PlotsBuilder {
  plots: Record<string, Plot> = {};

  make(title: string, color: string): void {
    this.plots[title] = { values: [], color, title };
  }

  set(key: string, value: number) {
    if (!this.plots[key]) {
      this.plots[key] = { values: [], color: '#333333', title: key };
    }
    this.plots[key].values.push(value);
  }

  export(): Plot[] {
    return Object.values(this.plots);
  }
}
