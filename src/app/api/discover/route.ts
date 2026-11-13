export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { ApifyClient } from "apify-client";

const MAX_CONCURRENT_RUNS = 2;
const ORG_ACTOR_OWNER = "spectral-soundworks";

async function getActiveRunCount(client: ApifyClient): Promise<number> {
    const result = await client.runs().list({ status: "RUNNING", limit: 20 });
    return result.items.length;
}

export async function POST(request: Request) {
    try {
        const { actorId, input } = await request.json();
        if (typeof actorId !== "string" || !actorId.trim() || !input || typeof input !== "object" || Array.isArray(input)) {
            return NextResponse.json(
                { error: "actorId and input are required" },
                { status: 400 }
            );
        }

        const personalToken = process.env.APIFY_TOKEN;
        const orgToken = process.env.APIFY_ORG_TOKEN;
        const isOrgActor = actorId.startsWith(`${ORG_ACTOR_OWNER}/`);
        const token = isOrgActor ? (orgToken || personalToken) : (personalToken || orgToken);

        if (!token) {
            return NextResponse.json(
                { error: "No Apify token configured for this search type. Please set APIFY_TOKEN and/or APIFY_ORG_TOKEN in .env." },
                { status: 500 }
            );
        }

        const client = new ApifyClient({ token });

        if (isOrgActor) {
            const activeCount = await getActiveRunCount(client);
            if (activeCount >= MAX_CONCURRENT_RUNS) {
                return NextResponse.json(
                    { error: `Concurrency limit reached (${MAX_CONCURRENT_RUNS} max). ${activeCount} runs are already active. Wait for one to finish and try again.` },
                    { status: 429 }
                );
            }
        }

        console.log(`[DISCOVER] Starting actor ${actorId} with ${isOrgActor ? "org" : "personal"} credentials`);

        const run = await client.actor(actorId).start(input);
        console.log(`[DISCOVER] Run started: ${run.id}`);

        return NextResponse.json({
            runId: run.id,
            datasetId: run.defaultDatasetId
        });
    } catch (error: any) {
        console.error("/api/discover error", error);
        
        let detail = error.message || String(error);
        if (error.response?.body) {
            detail += ` | Response: ${typeof error.response.body === 'string' ? error.response.body.substring(0, 500) : JSON.stringify(error.response.body)}`;
        }

        const status = error.statusCode || error.response?.status || 500;
        return NextResponse.json(
            { error: "Failed to run discovery actor", detail },
            { status: status >= 400 && status < 600 ? status : 500 }
        );
    }
}
