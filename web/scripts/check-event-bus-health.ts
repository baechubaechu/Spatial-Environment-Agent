import { setTimeout as sleep } from "timers/promises";

const base = process.env.EVENT_BRIDGE_BASE_URL ?? "http://127.0.0.1:3001";

async function getJson(path: string) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function main() {
  console.log(`[check] base=${base}`);
  const state = (await getJson("/api/events/state")) as {
    queueSize: number;
    services: Array<{ service: string; effectiveStatus: string; ageMs: number; stale: boolean }>;
  };

  console.log(`[check] queueSize=${state.queueSize}`);
  if (!state.services.length) {
    console.log("[warn] no heartbeat services yet");
  }
  for (const s of state.services) {
    console.log(`[service] ${s.service}: ${s.effectiveStatus} age=${s.ageMs}ms stale=${s.stale}`);
  }

  await fetch(`${base}/api/events/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetZone: "all", reason: "ops health check" }),
  });

  await sleep(300);
  const pull = (await getJson("/api/events/pull?after=0&topics=scene.execute&limit=3")) as {
    items: Array<{ topic: string; payload: { sceneId?: string } }>;
  };
  const hasSafe = pull.items.some((i) => i.topic === "scene.execute" && i.payload?.sceneId === "safe_neutral");
  if (!hasSafe) throw new Error("safe_neutral recovery event was not observed");

  console.log("[ok] event bus health checks passed");
}

main().catch((err) => {
  console.error("[fail]", err);
  process.exit(1);
});
