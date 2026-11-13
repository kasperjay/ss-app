import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), start: vi.fn() }));
vi.mock("apify-client", () => ({ ApifyClient: class {
    runs() { return { list: mocks.list }; }
    actor() { return { start: mocks.start }; }
} }));
import { POST } from "./route";
function request(actorId: unknown = "spectral-soundworks/search", input: unknown = {}) {
    return new Request("http://localhost/api/discover", { method: "POST", body: JSON.stringify({ actorId, input }) });
}
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("APIFY_TOKEN", "test-only-token");
    mocks.list.mockResolvedValue({ items: [] });
    mocks.start.mockResolvedValue({ id: "run-1", defaultDatasetId: "dataset-1" });
});
it("does not start a job when the concurrency lookup fails", async () => {
    mocks.list.mockRejectedValue(new Error("lookup unavailable"));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.start).not.toHaveBeenCalled();
});
it("rejects jobs at the concurrency limit", async () => {
    mocks.list.mockResolvedValue({ items: [{}, {}] });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.start).not.toHaveBeenCalled();
});
it.each([[42, {}], ["actor", []], ["", {}]])("rejects malformed input", async (actor, input) => {
    expect((await POST(request(actor, input))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
});
it("starts valid discovery and returns run identifiers", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runId: "run-1", datasetId: "dataset-1" });
});
