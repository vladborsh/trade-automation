import { add, isWeekend } from 'date-fns';

export function isTradingHour(date: Date): boolean {
  const hour = date.getUTCHours();
  const day = date.getUTCDay();

  // market closes at 21:00 UTC on Friday
  if (day === 5 && hour >= 21) {
    return false;
  }

  if (hour >= 21 && hour < 22 ) {
    return false;
  }

  return true;
}

export function getNextValidTime(currentTime: Date): Date {
  let newTime = new Date(currentTime);

  while (!isTradingHour(newTime) || isWeekend(newTime)) {
    const day = newTime.getUTCDay();
    const hour = newTime.getUTCHours();

    if (day === 5 && hour >= 21) { // It's Friday after market closing
      newTime.setUTCDate(newTime.getUTCDate() + 2); // Move to Sunday
      newTime.setUTCHours(22, 0, 0, 0); // Set to 22:00 UTC
    } else if (day === 6) { // It's Saturday
      newTime.setUTCDate(newTime.getUTCDate() + 1); // Move to Sunday
      newTime.setUTCHours(22, 0, 0, 0); // Set to 22:00 UTC
    } else if (day === 0 && hour < 22) { // It's Sunday before market opens
      newTime.setUTCHours(22, 0, 0, 0); // Set to 22:00 UTC
    } else if (!isTradingHour(newTime)) { // Non-trading hours on weekdays
      newTime.setUTCHours(22, 0, 0, 0); // Move to next valid hour (22:00 UTC)
    } else {
      break; // It's a valid trading hour on a trading day
    }
    newTime = new Date(newTime); // Refresh the date object to apply changes
  }

  return newTime;
}

export function adjustEndTime(startTime: Date, duration: Duration): Date {
  let endTime = add(startTime, duration);

  if (isWeekend(endTime) || !isTradingHour(endTime)) {
    if (endTime.getUTCDay() === 5 && endTime.getUTCHours() >= 21) {
      endTime.setUTCHours(20, 59, 59, 999);
    } else {
      if (endTime.getUTCDay() === 6 || (endTime.getUTCDay() === 0 && endTime.getUTCHours() < 22)) {
        endTime = new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate());
        endTime.setUTCHours(20, 59, 59);
        endTime.setUTCDate(endTime.getUTCDate() - (endTime.getUTCDay() === 6 ? 1 : 0)); // Go back to Friday if it's Saturday
      }
    }
  }

  return endTime;
}
