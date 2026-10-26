/* The browser's calendar for suites whose fixture pins the server clock (READER_TEST_CLOCK, sent as `now` on the
   fixture's first line; see reader_mcp/clock.py). pinDate makes the page's Date start at that instant and advance in
   real time, so "today" and "this week's issue" agree with the fixture whenever and wherever the suite runs (#131).

   Only Date changes. Playwright's clock (page.clock.install, setFixedTime) also replaces setTimeout,
   requestAnimationFrame and performance.now with fakes driven by one timer, which changes what frame-rate,
   transition and hover-delay checks measure (web_art's 30 fps cap, web_hero's raster after two frames, web_art_focus's
   hover card all behave differently under it). Suites that need to control timers themselves use page.clock
   directly, as tests/web_dates.cjs does. */
async function pinDate(context,now){
  if(!now||Number.isNaN(Date.parse(now)))throw new Error('pinDate needs the fixture clock instant, got '+JSON.stringify(now));
  await context.addInitScript(start=>{
    const Real=Date,offset=start-Real.now();
    class PinnedDate extends Real{constructor(...args){if(args.length)super(...args);else super(Real.now()+offset);}static now(){return Real.now()+offset;}}
    globalThis.Date=PinnedDate;
  },Date.parse(now));
  return context;
}
module.exports={pinDate};
