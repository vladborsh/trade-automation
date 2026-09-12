import { CapComTimeIntervals, GeneralTimeIntervals } from "../../../types/enums";

export const mapGeneralTimeIntervalToCapCom: Record<GeneralTimeIntervals, CapComTimeIntervals> = {
  [GeneralTimeIntervals.m1]: CapComTimeIntervals.MINUTE,
  [GeneralTimeIntervals.m3]: CapComTimeIntervals.MINUTE_3,
  [GeneralTimeIntervals.m5]: CapComTimeIntervals.MINUTE_5,
  [GeneralTimeIntervals.m15]: CapComTimeIntervals.MINUTE_15,
  [GeneralTimeIntervals.m30]: CapComTimeIntervals.MINUTE_30,
  [GeneralTimeIntervals.h1]: CapComTimeIntervals.HOUR,
  [GeneralTimeIntervals.h4]: CapComTimeIntervals.HOUR_4,
  [GeneralTimeIntervals.d1]: CapComTimeIntervals.DAY,
  [GeneralTimeIntervals.w1]: CapComTimeIntervals.WEEK,
};

export const capitalComIntervalToMinutes: Record<CapComTimeIntervals, number> = {
  [CapComTimeIntervals.MINUTE]: 1,
  [CapComTimeIntervals.MINUTE_3]: 3,
  [CapComTimeIntervals.MINUTE_5]: 5,
  [CapComTimeIntervals.MINUTE_15]: 15,
  [CapComTimeIntervals.MINUTE_30]: 30,
  [CapComTimeIntervals.HOUR]: 0, // TODO
  [CapComTimeIntervals.HOUR_4]: 0, // TODO
  [CapComTimeIntervals.DAY]: 0, // TODO
  [CapComTimeIntervals.WEEK]: 0, // TODO
};
