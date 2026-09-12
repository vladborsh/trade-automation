import { adjustEndTime, getNextValidTime, isTradingHour } from "./data-scrapper.helper";


describe('Time Functions', () => {
  describe('isTradingHour', () => {
    it('returns false for Friday post 21:00 UTC', () => {
      const date = new Date('2023-11-24T21:01:00Z'); // Friday 21:01 UTC
      expect(isTradingHour(date)).toBe(false);
    });

    it('returns true for normal trading hours', () => {
      const date = new Date('2023-11-23T20:00:00Z'); // Thursday 20:00 UTC
      expect(isTradingHour(date)).toBe(true);
    });

    it('returns true for a weekday during trading hours', () => {
      const date = new Date('2023-11-23T15:00:00Z'); // Thursday 15:00 UTC
      expect(isTradingHour(date)).toBe(true);
    });

    it('returns false for a weekday outside trading hours', () => {
      const date = new Date('2023-11-23T21:00:00Z'); // Thursday 21:00 UTC
      expect(isTradingHour(date)).toBe(false);
    });
  });

  describe('getNextValidTime', () => {
    it('adjusts time to Sunday 22:00 UTC if given Saturday any time', () => {
      const saturday = new Date('2023-11-25T15:00:00Z'); // Saturday 15:00 UTC
      expect(getNextValidTime(saturday)).toEqual(new Date('2023-11-26T22:00:00Z'));
    });

    it('returns the same time if it is within trading hours and not weekend', () => {
      const date = new Date('2023-11-23T20:00:00Z'); // Thursday 20:00 UTC
      expect(getNextValidTime(date)).toEqual(date);
    });

    it('adjusts time to Sunday 22:00 UTC if given Sunday before 22:00 UTC', () => {
      const date = new Date('2023-11-26T21:00:00Z'); // Sunday 21:00 UTC
      const expected = new Date('2023-11-26T22:00:00Z'); // Monday 22:00 UTC
      expect(getNextValidTime(date)).toEqual(expected);
    });
  });

  describe('adjustEndTime', () => {
    it('adjusts end time to before the market close on Friday if it exceeds trading hours', () => {
      const friday = new Date('2023-11-24T20:30:00Z'); // Friday 20:30 UTC
      const duration = { hours: 1 }; // Adds 1 hour
      const adjustedTime = adjustEndTime(friday, duration);
      const expectedTime = new Date('2023-11-24T20:59:59.999Z'); // Adjusted just before market close
      expect(adjustedTime).toEqual(expectedTime);
    });

    it('does not adjust the end time if it does not fall on weekend or outside trading hours', () => {
      const startTime = new Date('2023-11-23T19:00:00Z'); // Thursday 19:00 UTC
      const duration = { hours: 1 };
      const expectedEndTime = new Date('2023-11-23T20:00:00Z');
      expect(adjustEndTime(startTime, duration)).toEqual(expectedEndTime);
    });

    it('adjusts end time to just before the market close on Friday', () => {
      const friday = new Date('2023-11-24T20:55:00Z'); // Friday close to trading end
      const duration = { minutes: 10 }; // Adds 10 minutes
      const expectedEndTime = new Date('2023-11-24T20:59:59.999Z'); // Before the close at 21:00 UTC
      expect(adjustEndTime(friday, duration)).toEqual(expectedEndTime);
    });
  });
});
