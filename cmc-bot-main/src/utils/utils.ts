export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatNumber(num: number): number {
  return Math.round(num * 10000) / 10000;
}

export function delayUntilNextMinute(): number {
  const now = new Date();

  const millisUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  return millisUntilNextMinute;
};
