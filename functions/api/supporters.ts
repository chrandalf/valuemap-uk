interface Env {
  BMC_ACCESS_TOKEN?: string;
}

type BmcSupporter = {
  supporter_name?: string;
  support_note?: string;
  support_visibility?: number;
};

type BmcResponse = {
  data?: BmcSupporter[];
};

type SupporterCacheEntry = {
  items: string[];
  loadedAtMs: number;
};

const BMC_CACHE_TTL_MS = 60_000;
const BMC_MAX_ITEMS = 50;
let SUPPORTER_CACHE: SupporterCacheEntry | null = null;

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 12);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(BMC_MAX_ITEMS, Math.floor(limitRaw))) : 12;

    if (!env.BMC_ACCESS_TOKEN) {
      return Response.json(
        { ok: true, items: [], message: "BMC_ACCESS_TOKEN not configured" },
        { headers: { "Cache-Control": "public, max-age=300" } }
      );
    }

    const now = Date.now();
    if (SUPPORTER_CACHE && now - SUPPORTER_CACHE.loadedAtMs <= BMC_CACHE_TTL_MS) {
      return Response.json(
        { ok: true, items: SUPPORTER_CACHE.items.slice(0, limit) },
        { headers: { "Cache-Control": "public, max-age=600" } }
      );
    }

    const apiRes = await fetch("https://developers.buymeacoffee.com/api/v1/supporters", {
      headers: {
        Authorization: `Bearer ${env.BMC_ACCESS_TOKEN}`,
        Accept: "application/json",
      },
    });

    if (!apiRes.ok) {
      const body = await apiRes.text();
      // eslint-disable-next-line no-console
      console.error("BMC API error", apiRes.status, body);
      return new Response(JSON.stringify({ error: "Failed to fetch supporters", status: apiRes.status }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = (await apiRes.json()) as BmcResponse;
    const raw = Array.isArray(payload.data) ? payload.data : [];

    const names = Array.from(
      new Set(
        raw
          .map((item) => (item.supporter_name ?? "").trim())
          .filter((name) => name.length > 0)
      )
    ).slice(0, BMC_MAX_ITEMS);

    SUPPORTER_CACHE = { items: names, loadedAtMs: Date.now() };

    return Response.json(
      { ok: true, items: names.slice(0, limit) },
      { headers: { "Cache-Control": "public, max-age=600" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Supporter lookup failed", message: err?.message ?? String(err) }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
};
