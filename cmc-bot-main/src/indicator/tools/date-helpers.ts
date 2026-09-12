import {
  getHours,
  getMinutes,
  isYesterday,
  isToday,
  differenceInDays,
  startOfDay,
  fromUnixTime,
  isSameWeek,
  subWeeks,
  startOfWeek,
  isSameMonth,
  subMonths,
  add,
  isWithinInterval,
  getDay,
  subDays,
  startOfMonth,
  isSameDay,
  addMinutes,
  addHours,
  set,
  isBefore,
  isAfter,
} from 'date-fns';

import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';


export function getTimeZoneShift(): number {
  // Create a date object for the current time to get the current timezone offset
  const currentDate = new Date();
  const timezoneOffsetInMinutes = currentDate.getTimezoneOffset();
  // Convert the timezone offset from minutes to milliseconds
  const timezoneOffsetInMilliseconds = timezoneOffsetInMinutes * 60000;
  return timezoneOffsetInMilliseconds;
}

export function isTimeEqualTo(inputTimestamp: number, hour: number, minute: number): boolean {
  const inputDate = new Date(inputTimestamp + getTimeZoneShift()); // with timezone shift
  const inputHour = getHours(inputDate);
  const inputMinute = getMinutes(inputDate);
  return inputHour === hour && inputMinute === minute;
}

export function isTimeBefore(inputTimestamp: number, hour: number, minute: number): boolean {
  const targetDate = getTargetTimeFromNYTime(inputTimestamp, hour, minute);

  return isBefore(inputTimestamp, targetDate);
}

export function isTimeAfter(inputTimestamp: number, hour: number, minute: number): boolean {
  const targetDate = getTargetTimeFromNYTime(inputTimestamp, hour, minute)

  return isAfter(inputTimestamp, targetDate);
}

export function isDaysAgo(date1: number, date2: number): boolean {
  return differenceInDays(startOfDay(date1), startOfDay(date2)) > 0;
}

export function isYesterdayWithLastCandle(date: number, lastCandleTimestamp: number): boolean {
  const yesterday = subDays(new Date(lastCandleTimestamp), 1);

  return isSameDay(new Date(date), yesterday);
}

export function isSameDayWithLastCandle(date: number, lastCandleTimestamp: number): boolean {
  return isSameDay(new Date(date), new Date(lastCandleTimestamp));
}

export function isPrevWeek(date: number, now: Date): boolean {
  const dayOfWeek = now.getDay();
  const startOfPreviousWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 7);
  const endOfPreviousWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 1);

  startOfPreviousWeek.setHours(0, 0, 0, 0);
  endOfPreviousWeek.setHours(23, 59, 59, 999);

  return date >= startOfPreviousWeek.getTime() && date <= endOfPreviousWeek.getTime();
}

export function isPrevMonth(date: number, now: Date): boolean {
  const oneMonthAgo = subMonths(now, 1);
  return isSameMonth(date, oneMonthAgo) && new Date(date).getFullYear() === oneMonthAgo.getFullYear();
}

export function isMinutesZero(timestamp: number): boolean {
  const date = fromUnixTime(timestamp);
  return getMinutes(date) === 0;
}

export function isHoursZero(timestamp: number): boolean {
  const date = new Date(timestamp);
  return date.getUTCHours() === 0;
}


export function getTargetTimeFromNYTime(date: number, targetHour: number, targetMinute: number): Date {
  const startOfTodayNY = startOfDay(new Date(date));
  const targetTimeNY = addMinutes(addHours(startOfTodayNY, targetHour), targetMinute);
  const targetTimeUTC = zonedTimeToUtc(targetTimeNY, 'America/New_York');

  return targetTimeUTC;
}

/**
 * Set start of the day in New York timezone and add the target hour and minute
 * Convert New York target time to UTC
 * Check if the target time falls within the given interval
 */
function isTimeInInterval(date1: number, date2: number, targetHour: number, targetMinute: number): boolean {
  if (date1 > date2) {
    return false;
  }
  const targetTimeUTC = getTargetTimeFromNYTime(date1, targetHour, targetMinute)

  return isWithinInterval(targetTimeUTC, { start: date1, end: date2 });
}

export function isNewYorkAMTrueOpen(date1: number, date2: number): boolean {
  return isTimeInInterval(date1, date2, 7, 30);
}

export function isNewYorkExchangeOpen(date1: number, date2: number): boolean {
  return isTimeInInterval(date1, date2, 9, 30);
}

export function isDayTrueOpen(date1: number, date2: number): boolean {
  return isTimeInInterval(date1, date2, 0, 0);
}

export function isTrueOpenOfWeek(date1: number, date2: number, now: Date) {
  if (date1 > date2) {
    return false;
  }
  const dayOfWeek = 2;
  const timeOfDay = { hour: 1, minute: 0, second: 0 };
  // Get the start of the current week
  const startOfCurrentWeek = startOfWeek(now, { weekStartsOn: 1 }); // assuming week starts on Monday

  // Calculate the day of the week for the specific time (e.g., Tuesday)
  let specificDayThisWeek = add(startOfCurrentWeek, { days: dayOfWeek - 1 }); // Adjust for the specific day of the week

  // If today is before the specific day this week, go back one week
  if (getDay(now) < dayOfWeek) {
    specificDayThisWeek = subDays(specificDayThisWeek, 7);
  }

  // Add the specific time to the day
  const specificTime = add(specificDayThisWeek, {
    hours: timeOfDay.hour,
    minutes: timeOfDay.minute,
    seconds: timeOfDay.second,
  });

  // Check if the specific time is between the two dates
  return isWithinInterval(specificTime, { start: date1, end: date2 });
}

export function isTrueOpenOfMonth(date1: number, date2: number, now: Date) {
  const currentDate = now;
  let year = now.getFullYear();
  let month = currentDate.getMonth();

  if (date1 > date2) {
    return false;
  }

  // Helper function to get the second Monday of a given month and year
  function getSecondMondayOfMonth(year: number, month: number) {
    let firstDayOfMonth = startOfMonth(new Date(year, month));
    let dayOffset = (8 - getDay(firstDayOfMonth)) % 7; // Offset to the first Monday
    let firstMonday = add(firstDayOfMonth, { days: dayOffset });
    return add(firstMonday, { days: 7 }); // Second Monday
  }
  let result: any;
  // Check if the second Monday of the current month is between the two dates
  try {
    let secondMonday = getSecondMondayOfMonth(year, month);
    if (!isWithinInterval(secondMonday, { start: date1, end: date2 })) {
      // If not, check the second Monday of the previous month
      let previousMonthDate = subMonths(new Date(year, month, 1), 1);
      year = previousMonthDate.getFullYear();
      month = previousMonthDate.getMonth();
      secondMonday = getSecondMondayOfMonth(year, month);
    }
    result = isWithinInterval(secondMonday, { start: date1, end: date2 });
  } catch (error) {
  }
  // Return whether the second Monday (current or previous month) is between the two dates
  return result;
}



