export function getTimeZoneShift(): number {
  // Create a date object for the current time to get the current timezone offset
  const currentDate = new Date();
  const timezoneOffsetInMinutes = currentDate.getTimezoneOffset();
  // Convert the timezone offset from minutes to milliseconds
  const timezoneOffsetInMilliseconds = timezoneOffsetInMinutes * 60000;
  return timezoneOffsetInMilliseconds;
}
