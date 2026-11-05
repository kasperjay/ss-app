import { afterEach, expect, it, vi } from "vitest";

const { scrape } = vi.hoisted(() => ({ scrape: vi.fn() }));
vi.mock("@/lib/scrapers", () => ({
  ACTIVE_VENUES: [{ id: "test" }],
  getVenue: () => ({ name: "Test Venue", calendarUrl: "https://example.com" }),
  getVenueScraper: () => scrape,
  isVenueActive: () => true,
  isVenueId: () => true,
}));
import { POST } from "./route";

const request = () => new Request("http://localhost/api/discover/calendar", {
  method: "POST", body: JSON.stringify({ venueIds: ["test"] }),
});
const success = { warnings: [], items: [], eventsFound: 0, eventPagesRead: 0 };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("releases the flag after success and failure", async () => {
  scrape.mockResolvedValueOnce(success).mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce(success);
  expect((await POST(request())).status).toBe(200);
  expect((await (await POST(request())).json()).status).toBe("failed");
  expect((await (await POST(request())).json()).status).toBe("success");
});

it("rejects overlapping searches and releases the flag when a scraper never settles", async () => {
  vi.useFakeTimers();
  scrape.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(success);
  const pending = POST(request());
  await vi.advanceTimersByTimeAsync(0);
  expect((await POST(request())).status).toBe(429);
  await vi.advanceTimersByTimeAsync(35_000);
  const result = await (await pending).json();
  expect(result.status).toBe("failed");
  expect(result.venues[0].error).toContain("timed out");
  expect((await (await POST(request())).json()).status).toBe("success");
  expect(vi.getTimerCount()).toBe(0);
});
