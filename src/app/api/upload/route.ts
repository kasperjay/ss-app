export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
    let writtenPath: string | undefined;
    try {
        const formData = await request.formData();
        const file = formData.get("file");
        const projectId = formData.get("projectId");
        const type = formData.get("type");

        if (!(file instanceof File) || typeof projectId !== "string" || !projectId.trim() || (type !== "WORKING" && type !== "DELIVERABLE")) {
            return NextResponse.json(
                { error: "Missing required fields (file, projectId, type)" },
                { status: 400 }
            );
        }

        const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        const uploadsDir = join(process.cwd(), "public", "uploads");
        await mkdir(uploadsDir, { recursive: true });

        const buffer = Buffer.from(await file.arrayBuffer());
        const uniqueKey = `${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const filePath = join(uploadsDir, uniqueKey);

        await writeFile(filePath, buffer, { flag: "wx" });
        writtenPath = filePath;

        const publicUrl = `/uploads/${uniqueKey}`;

        const newFile = await prisma.projectFile.create({
            data: {
                projectId,
                name: file.name,
                url: publicUrl,
                key: uniqueKey,
                size: file.size,
                mimeType: file.type,
                type: type,
            },
        });

        writtenPath = undefined;
        return NextResponse.json({ success: true, file: newFile });
    } catch (error) {
        if (writtenPath) {
            await unlink(writtenPath).catch((cleanupError) => console.error("Failed to remove incomplete upload:", cleanupError));
        }
        console.error("Error saving file:", error);
        return NextResponse.json(
            { error: "Failed to upload file" },
            { status: 500 }
        );
    }
}
