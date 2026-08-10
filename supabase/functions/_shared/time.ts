// Convert an instant into a user's local wall clock. IANA time zones are the
// source of truth because a fixed offset becomes wrong at DST boundaries or
// after the user travels. The saved offset remains a compatibility fallback
// for older rows and environments where Intl rejects a stored zone.

type LocalClock = {
  date: string;
  yesterday: string;
  msSinceMidnight: number;
};

function shiftedDateFromOffset(nowMs: number, offsetMinutes: number): Date {
  return new Date(nowMs + (offsetMinutes || 0) * 60000);
}

function dateMinusOne(date: string): string {
  const noon = new Date(`${date}T12:00:00Z`);
  noon.setUTCDate(noon.getUTCDate() - 1);
  return noon.toISOString().slice(0, 10);
}

export function localClock(nowMs: number, timeZone: string | null | undefined, fallbackOffsetMinutes: number | null | undefined): LocalClock {
  let date = '';
  let hour = 0;
  let minute = 0;
  let second = 0;

  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        calendar: 'gregory',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date(nowMs));
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      date = `${values.year}-${values.month}-${values.day}`;
      hour = Number(values.hour) || 0;
      minute = Number(values.minute) || 0;
      second = Number(values.second) || 0;
    } catch (_) {
      // Invalid/obsolete zone: use the offset written by older app versions.
    }
  }

  if (!date) {
    const shifted = shiftedDateFromOffset(nowMs, fallbackOffsetMinutes ?? 0);
    date = shifted.toISOString().slice(0, 10);
    hour = shifted.getUTCHours();
    minute = shifted.getUTCMinutes();
    second = shifted.getUTCSeconds();
  }

  return {
    date,
    yesterday: dateMinusOne(date),
    msSinceMidnight: ((hour * 60 + minute) * 60 + second) * 1000,
  };
}
