import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findUnique: vi.fn() }, projectFile: { create: vi.fn() } } }));
vi.mock("fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));
import { prisma } from "@/lib/prisma";
import { writeFile, unlink } from "fs/promises";
import { POST } from "./route";
function request(file: File | string = new File(["audio"], "song.wav"), type = "WORKING") {
    const body = new FormData();
    body.set("file", file);
    body.set("type", type);
    body.set("projectId", "project-1");
    return new Request("http://localhost/api/upload", { method: "POST", body });
}
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "project-1" } as never);
    vi.mocked(prisma.projectFile.create).mockResolvedValue({ id: "file-1" } as never);
});
it.each([["text", "WORKING"], [new File(["a"], "a.wav"), "INVALID"]])("rejects invalid upload fields", async (file, type) => {
    expect((await POST(request(file, type))).status).toBe(400);
    expect(writeFile).not.toHaveBeenCalled();
});
it("rejects missing projects before writing files", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
    expect(writeFile).not.toHaveBeenCalled();
});
it("removes the disk file when metadata cannot be saved", async () => {
    vi.mocked(prisma.projectFile.create).mockRejectedValue(new Error("database unavailable"));
    expect((await POST(request())).status).toBe(500);
    expect(unlink).toHaveBeenCalledWith(vi.mocked(writeFile).mock.calls[0][0]);
});
it("preserves successful uploads and assigns distinct keys", async () => {
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    const calls = vi.mocked(writeFile).mock.calls;
    expect(calls[0][0]).not.toBe(calls[1][0]);
    expect(calls[0][2]).toEqual({ flag: "wx" });
    expect(unlink).not.toHaveBeenCalled();
});
it("does not delete existing files when the exclusive write fails", async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error("EEXIST"));
    expect((await POST(request())).status).toBe(500);
    expect(unlink).not.toHaveBeenCalled();
});
