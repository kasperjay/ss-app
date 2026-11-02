import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_VENUES, MVP_VENUES, isVenueActive } from "./config";
import { getVenueScraper } from "./index";
import { scrapeDo512Venue, scrapeFarOutVenue, scrapeTheCutVenue, splitArtistTitle } from "./shared";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function calendarCard(title: string, date: string, slug: string): string {
  return `<article itemprop="event"><h3 itemprop="name">${title}</h3><time itemprop="startDate" datetime="${date}"></time><a itemprop="url" href="/events/${slug}">Details</a></article>`;
}

describe("direct venue calendar scrapers", () => {
  it("keeps the six approved MVP venues, including Come and Take It Live", () => {
    expect(MVP_VENUES.map((venue) => venue.name)).toEqual([
      "Come and Take It Live",
      "Continental Club",
      "Continental Gallery",
      "Hotel Vegas",
      "Antone's",
      "Mohawk",
    ]);
  });

  it("registers all active venues and leaves closed venues out of selectable search", () => {
    expect(ACTIVE_VENUES.map((venue) => venue.id)).toEqual([
      "come-and-take-it",
      "continental-club",
      "continental-gallery",
      "hotel-vegas",
      "antones",
      "mohawk",
      "haute-spot",
      "parker-jazz",
      "the-cut",
      "scoot-inn",
      "saxon-pub",
      "elephant-room",
      "cboys",
      "broken-spoke",
      "3ten",
      "valhalla-tavern",
      "cheer-up-charlies",
      "swan-dive",
      "chess-club",
      "hole-in-the-wall",
      "far-out-lounge",
      "carousel-lounge",
      "kick-butt-coffee",
    ]);
    expect(ACTIVE_VENUES.every((venue) => typeof getVenueScraper(venue.id) === "function")).toBe(true);
    expect(isVenueActive("empire-atx")).toBe(false);
    expect(isVenueActive("valhalla-tavern")).toBe(true);
  });

  it("splits each lineup artist separately and excludes non-music events", () => {
    expect(splitArtistTitle("Headliner w/ Support One, Support Two")).toEqual([
      "Headliner",
      "Support One",
      "Support Two",
    ]);
    expect(splitArtistTitle("Trivia Night at Hotel Vegas")).toEqual([]);
  });

  it("filters the rolling 30-day window, follows event pages, and falls back to event-title lineups", async () => {
    const now = new Date("2026-01-10T18:00:00.000Z");
    const withinWindow = calendarCard("Night Show", "2026-01-20T20:00:00-06:00", "night-show");
    const fallback = calendarCard("Headliner w/ Support One, Support Two", "2026-02-01T20:00:00-06:00", "fallback-show");
    const outsideWindow = calendarCard("Too Late", "2026-03-01T20:00:00-06:00", "outside-window");
    const calendarHtml = `${withinWindow}${fallback}${outsideWindow}${calendarCard("Movie Club", "2026-01-21T20:00:00-06:00", "movie-club")}`;
    const detailHtml = `
      <meta name="description" content="A live music bill">
      <div itemprop="performer"><a itemprop="url" href="/artists/artist-one"><span itemprop="name">Artist One</span></a></div>
      <script type="application/ld+json">{"@type":"MusicEvent","performer":[{"@type":"MusicGroup","name":"Artist Two","url":"https://do512.com/artists/artist-two"}]}</script>
    `;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/month_events")) {
        return new Response(calendarHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.endsWith("/events/night-show")) {
        return new Response(detailHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.endsWith("/events/fallback-show")) {
        return new Response("blocked", { status: 503, headers: { "content-type": "text/html" } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const venue = MVP_VENUES.find((item) => item.id === "come-and-take-it")!;
    const result = await scrapeDo512Venue(venue, now);

    expect(result.eventsFound).toBe(3);
    expect(result.items.map((item) => item.artist).sort()).toEqual([
      "Artist One",
      "Artist Two",
      "Headliner",
      "Support One",
      "Support Two",
    ]);
    expect(result.items.find((item) => item.artist === "Artist One")).toMatchObject({
      eventTitle: "Night Show",
      eventUrl: "https://family.do512.com/events/night-show",
      artistProfileUrl: "https://family.do512.com/artists/artist-one",
      description: "A live music bill",
    });
    expect(result.eventPagesRead).toBe(1);
    expect(result.warnings).toContain("1 event detail page(s) could not be loaded; event titles were used as fallback.");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("outside-window"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("movie-club"), expect.anything());
  });

  it("scrapes The Cut lineup cards into separate artist rows and reads event details", async () => {
    const now = new Date("2026-10-10T18:00:00.000Z");
    const calendarHtml = `
      <a href="/tickets/october-show" aria-label="October 20">
        <span class="spineCol">Tue October 20</span>
        <span class="headlinerName">Headliner</span>
        <span class="supportName">Support Artist</span>
        <span class="eventMeta">Show 2000 – 2200</span>
      </a>
      <a href="/tickets/outside-show" aria-label="November 25">
        <span class="spineCol">Wed November 25</span>
        <span class="headlinerName">Outside Artist</span>
      </a>
    `;
    const detailHtml = `<meta name="description" content="October live show">`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://www.thecutatx.com/") {
        return new Response(calendarHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url === "https://www.thecutatx.com/tickets/october-show") {
        return new Response(detailHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const venue = ACTIVE_VENUES.find((item) => item.id === "the-cut")!;
    const result = await scrapeTheCutVenue(venue, now);

    expect(result.eventsFound).toBe(1);
    expect(result.items.map((item) => item.artist).sort()).toEqual(["Headliner", "Support Artist"]);
    expect(result.items[0]).toMatchObject({
      venueName: "The Cut ATX",
      eventTitle: "Headliner w/ Support Artist",
      eventUrl: "https://www.thecutatx.com/tickets/october-show",
      description: "October live show",
      eventDateOnly: false,
    });
    expect(result.eventPagesRead).toBe(1);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("outside-show"), expect.anything());
  });

  it("enforces the 30-second per-venue timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));

    const search = scrapeDo512Venue(MVP_VENUES[0], new Date("2026-10-10T18:00:00.000Z"));
    const timedOut = expect(search).rejects.toThrow("Venue scraper timed out after 30 seconds.");
    await vi.advanceTimersByTimeAsync(30_000);
    await timedOut;
  });

  it("retries a transient venue-calendar error once", async () => {
    const now = new Date("2026-01-01T18:00:00.000Z");
    const calendarHtml = calendarCard("Retry Artist", "2026-01-20T20:00:00-06:00", "retry-show");
    let calendarAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/month_events")) {
        calendarAttempts += 1;
        if (calendarAttempts === 1) return new Response("temporary failure", { status: 503 });
        return new Response(calendarHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.endsWith("/events/retry-show")) {
        return new Response(`<div itemprop="performer"><span itemprop="name">Retry Artist</span></div>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const venue = MVP_VENUES.find((item) => item.id === "come-and-take-it")!;
    const result = await scrapeDo512Venue(venue, now);

    expect(calendarAttempts).toBe(2);
    expect(result.items.map((item) => item.artist)).toEqual(["Retry Artist"]);
    expect(result.warnings).toEqual([]);
  });

  it("supports event pages linked from the standard Do512 host", async () => {
    const now = new Date("2026-10-10T18:00:00.000Z");
    const crossHost = `<article itemprop="event"><h3 itemprop="name">Cross-Host Artist</h3><time itemprop="startDate" datetime="2026-10-20T20:00:00-05:00"></time><a itemprop="url" href="https://family.do512.com/events/cross-host">Details</a></article>`;
    const calendarHtml = `${calendarCard("Standard Domain Artist", "2026-10-20T20:00:00-05:00", "standard-show")}${crossHost}`;
    const detailHtml = `<div itemprop="performer"><span itemprop="name">Standard Domain Artist</span></div>`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/month_events")) {
        return new Response(calendarHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url === "https://do512.com/events/standard-show") {
        return new Response(detailHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const venue = ACTIVE_VENUES.find((item) => item.id === "haute-spot")!;
    const result = await scrapeDo512Venue(venue, now);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      artist: "Standard Domain Artist",
      eventUrl: "https://do512.com/events/standard-show",
      venueName: "Haute Spot",
    });
    expect(result.eventPagesRead).toBe(1);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("cross-host"), expect.anything());
  });

  it("reads Far Out's published Firebase event feed and splits music bills", async () => {
    const now = new Date("2026-10-10T18:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://fol-event-management.firebaseio.com/events.json");
      return new Response(JSON.stringify({
        event_one: {
          metadata: {
            date: "Sat Oct 24 2026 19:00:00 GMT-0500 (Central Daylight Time)",
            isPublished: true,
            title: "Headliner w/ Support Artist",
            shortDescription: "Live at Far Out",
          },
        },
        old_event: {
          metadata: {
            date: "Sat Sep 24 2026 19:00:00 GMT-0500 (Central Daylight Time)",
            isPublished: true,
            title: "Old Show",
          },
        },
      }), { headers: { "content-type": "application/json" } });
    }));

    const venue = ACTIVE_VENUES.find((item) => item.id === "far-out-lounge")!;
    const result = await scrapeFarOutVenue(venue, now);

    expect(result.eventsFound).toBe(1);
    expect(result.items.map((item) => item.artist)).toEqual(["Headliner", "Support Artist"]);
    expect(result.items[0]).toMatchObject({
      venueName: "The Far Out Lounge",
      eventUrl: "https://www.thefaroutaustin.com/eventDetails.html#event_one",
      description: "Live at Far Out",
    });
  });

});
