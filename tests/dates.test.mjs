// Local-time dates: plain calendar dates stay as written; instants are shown and grouped in the reader's zone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays, daysBetween, formatDate, formatDateTime, isPlainDate, localDay, localizeLibrary, readActivity, todayLocal, workDay} from '../src/reader_mcp/web_ui/logic.mjs';
import {historyDayLabel, historyDays} from '../src/reader_mcp/web_ui/queue.mjs';

const LA = 'America/Los_Angeles', TOKYO = 'Asia/Tokyo';

test('a plain YYYY-MM-DD is a calendar date in every zone; an instant is its local day', () => {
  assert.equal(isPlainDate('2026-10-25'), true);
  assert.equal(isPlainDate('2026-10-25T00:16:00Z'), false);
  for (const zone of [LA, TOKYO, 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    assert.equal(localDay('2026-10-25', zone), '2026-10-25', zone);
    assert.equal(formatDate('2026-10-25', {timeZone:zone}), 'Oct 25', zone);
  }
  // 00:16Z is the previous evening in Los Angeles and already morning in Tokyo.
  assert.equal(localDay('2026-10-25T00:16:00Z', LA), '2026-10-24');
  assert.equal(formatDate('2026-10-25T00:16:00Z', {timeZone:LA}), 'Oct 24');
  assert.equal(localDay('2026-10-24T15:16:00Z', TOKYO), '2026-10-25');
  assert.equal(formatDate('2026-10-24T15:16:00Z', {timeZone:TOKYO}), 'Oct 25');
  assert.equal(formatDate('2026-10-24T15:16:00Z', {timeZone:'UTC'}), 'Oct 24');
  // Offsets in the string are honoured: a commit stamped in another zone is still one instant.
  assert.equal(localDay('2026-10-24T20:30:00-07:00', TOKYO), '2026-10-25');
  assert.equal(formatDate('2026-10-25', {year:true}), 'Oct 25, 2026');
  assert.equal(formatDate(null), 'Undated');
  assert.equal(formatDate('not a date'), 'Undated');
  assert.equal(localDay('not a date', LA), null);
});

test('DST edges: the local day follows the zone offset in force at that instant', () => {
  // US spring forward 2026-03-08 at 10:00Z (02:00 PST → 03:00 PDT); fall back 2026-11-01 at 09:00Z.
  assert.equal(localDay('2026-03-08T07:59:00Z', LA), '2026-03-07');   // 23:59 PST
  assert.equal(localDay('2026-03-08T08:00:00Z', LA), '2026-03-08');   // 00:00 PST
  assert.equal(localDay('2026-03-09T06:59:00Z', LA), '2026-03-08');   // 23:59 PDT
  assert.equal(localDay('2026-03-09T07:00:00Z', LA), '2026-03-09');   // 00:00 PDT, one hour earlier in UTC
  assert.equal(localDay('2026-11-01T06:59:00Z', LA), '2026-10-31');   // 23:59 PDT
  assert.equal(localDay('2026-11-01T07:00:00Z', LA), '2026-11-01');
  assert.equal(localDay('2026-11-02T07:59:00Z', LA), '2026-11-01');   // 23:59 PST
  assert.equal(localDay('2026-11-02T08:00:00Z', LA), '2026-11-02');
  // Calendar-day arithmetic is unaffected by the 23- and 25-hour days.
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.match(formatDateTime('2026-03-09T06:59:00Z', LA), /^Mar 8, 2026, 11:59\sPM PDT$/);
  assert.match(formatDateTime('2026-11-02T07:59:00Z', LA), /^Nov 1, 2026, 11:59\sPM PST$/);
});

test('works and the library bootstrap use local days for instants and keep calendar dates', () => {
  assert.equal(workDay({date:'2026-10-25', arrival_time:'2026-10-25T00:16:00+00:00'}, LA), '2026-10-24');
  assert.equal(workDay({date:'2026-10-25', arrival_time:null}, LA), '2026-10-25');
  const data = {today:'2026-10-25', works:[{primary:'a', date:'2026-10-25', arrival_time:'2026-10-25T00:16:00+00:00'}, {primary:'b', date:'2026-10-20'}], recent:[]};
  localizeLibrary(data, new Date('2026-10-25T00:20:00Z'), LA);
  assert.equal(data.today, '2026-10-24');
  assert.equal(data.utc_today, '2026-10-25');
  assert.deepEqual(data.works.map(w => w.date), ['2026-10-24', '2026-10-20']);
  assert.equal(data.works[0].catalog_date, '2026-10-25');
  localizeLibrary(data, new Date('2026-10-25T00:20:00Z'), LA);   // idempotent
  assert.equal(data.works[0].date, '2026-10-24');
  assert.equal(todayLocal(new Date('2026-10-24T15:16:00Z'), TOKYO), '2026-10-25');
});

test('reading activity counts read marks by local day', () => {
  const works = [{read:true, read_at:'2026-10-25T00:16:00Z'}, {read:true, read_at:'2026-10-24T18:00:00Z'}, {read:false, read_at:'2026-10-24T18:00:00Z'}, {read:true, read_at:'2026-09-01T12:00:00Z'}];
  const la = readActivity(works, '2026-10-24', 28, LA);
  assert.equal(la.length, 28);
  assert.equal(la.at(-1).date, '2026-10-24');
  assert.equal(la[0].date, '2026-09-27');
  assert.equal(la.at(-1).count, 2, 'both marks fall on Oct 24 in Los Angeles');
  const tokyo = readActivity(works, '2026-10-25', 28, TOKYO);
  assert.equal(tokyo.at(-1).count, 2, 'both marks fall on Oct 25 in Tokyo (18:00Z is 03:00 the next morning)');
  assert.equal(tokyo.reduce((n, d) => n + d.count, 0), 2, 'unread and out-of-window marks are excluded');
});

test('history groups by the local day of each open, across server pages', () => {
  const pages = [{date:'2026-10-25', items:[{opened_at:'2026-10-25T00:16:00+00:00', path:'a'}, {opened_at:'2026-10-24T23:00:00+00:00', path:'b'}]},
                 {date:'2026-10-24', items:[{opened_at:'2026-10-24T06:00:00+00:00', path:'c'}]}];
  assert.deepEqual(historyDays(pages, LA).map(d => [d.date, d.items.map(i => i.path)]), [['2026-10-24', ['a', 'b']], ['2026-10-23', ['c']]]);
  assert.deepEqual(historyDays(pages, TOKYO).map(d => [d.date, d.items.map(i => i.path)]), [['2026-10-25', ['a', 'b']], ['2026-10-24', ['c']]]);
  assert.equal(historyDayLabel('2026-10-24', '2026-10-24'), 'Today');
  assert.equal(historyDayLabel('2026-10-23', '2026-10-24'), 'Yesterday');
  assert.equal(historyDayLabel('2026-10-21', '2026-10-24'), 'Oct 21');
  assert.equal(historyDayLabel('2025-12-31', '2026-01-02'), 'Dec 31, 2025');
  assert.equal(historyDayLabel('2026-03-07', '2026-03-08'), 'Yesterday', 'a 23-hour day is still one day');
});
