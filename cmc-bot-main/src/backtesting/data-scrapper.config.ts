import { GeneralTimeIntervals } from "../types/enums";

export const dataScrapperIntervalStepConfig: Record<GeneralTimeIntervals, Duration> = {
  [GeneralTimeIntervals.m1]: { minutes: 500 },
  [GeneralTimeIntervals.m3]: { minutes: 1500 },
  [GeneralTimeIntervals.m5]: { minutes: 2500 },
  [GeneralTimeIntervals.m15]: { minutes: 7500 },
  [GeneralTimeIntervals.m30]: { minutes: 15000 },
  [GeneralTimeIntervals.h1]: { hours: 500 },
  [GeneralTimeIntervals.h4]: { hours: 2000 },
  [GeneralTimeIntervals.d1]: { days: 30 },
  [GeneralTimeIntervals.w1]: { weeks: 10 },
};

export const intervalsToMillisecondsConfig: Record<GeneralTimeIntervals, number> = {
  [GeneralTimeIntervals.m1]: 60 * 1000,
  [GeneralTimeIntervals.m3]: 60 * 1000 * 3,
  [GeneralTimeIntervals.m5]: 60 * 1000 * 5,
  [GeneralTimeIntervals.m15]: 60 * 1000 * 15,
  [GeneralTimeIntervals.m30]: 60 * 1000 * 30,
  [GeneralTimeIntervals.h1]: 60 * 60 * 1000,
  [GeneralTimeIntervals.h4]: 60 * 60 * 1000 * 4,
  [GeneralTimeIntervals.d1]: 60 * 60 * 24 * 1000,
  [GeneralTimeIntervals.w1]: 60 * 60 * 24 * 7 * 1000,
};
