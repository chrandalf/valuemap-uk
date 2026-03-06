export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const url = new URL(request.url);
    const postcodeRaw = (url.searchParams.get("postcode") ?? "").trim();
    const minutesRaw = Number(url.searchParams.get("minutes") ?? "45");
    const minutes = normalizeMinutes(minutesRaw);

    if (!postcodeRaw) return jsonError("Missing postcode", 400);
    if (!minutes) return jsonError("Invalid minutes. Use 15, 30, 45 or 60.", 400);

    const token = env.COMMUTE_ISOCHRONE_MAPBOX_TOKEN ?? env.MAPBOX_ACCESS_TOKEN;
    if (!token) {
      return jsonError("Commute filter needs a server-side Mapbox token. Set COMMUTE_ISOCHRONE_MAPBOX_TOKEN (or MAPBOX_ACCESS_TOKEN) in the deployment environment.", 503);
    }

    const normalizedPostcode = normalizePostcode(postcodeRaw);
    if (!normalizedPostcode) return jsonError("Invalid postcode", 400);

    const cacheKey = `${normalizedPostcode}|${minutes}`;
    const cached = ISOCHRONE_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.loadedAtMs <= CACHE_TTL_MS) {
      return jsonResponse(cached.payload);
    }

    const origin = await lookupPostcodeCoords(normalizedPostcode);
    if (!origin) return jsonError("Postcode not found", 404);

    const mbUrl = new URL(`https://api.mapbox.com/isochrone/v1/mapbox/driving/${origin.lon},${origin.lat}`);
    mbUrl.searchParams.set("contours_minutes", String(minutes));
    mbUrl.searchParams.set("polygons", "true");
    mbUrl.searchParams.set("denoise", "1");
    mbUrl.searchParams.set("generalize", "200");
    mbUrl.searchParams.set("access_token", token);

    const res = await fetch(mbUrl.toString(), {
      headers: { "User-Agent": "valuemap-uk/commute-isochrone" },
    });
    if (!res.ok) {
      const text = await safeText(res);
      return jsonError(`Isochrone lookup failed (${res.status})${text ? `: ${text}` : ""}`, 502);
    }

    const data = (await res.json()) as any;
    const feature = Array.isArray(data?.features) ? data.features[0] : null;
    const geometry = feature?.geometry;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
      return jsonError("Isochrone service returned no polygon", 502);
    }

    const payload = { normalizedPostcode, minutes, origin, geometry };
    ISOCHRONE_CACHE.set(cacheKey, { payload, loadedAtMs: Date.now() });
    return jsonResponse(payload);
  } catch (err: any) {
    return jsonError(err?.message || String(err), 500);
  }
};

type Env = {
  COMMUTE_ISOCHRONE_MAPBOX_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
};

type LonLat = { lon: number; lat: number };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ISOCHRONE_CACHE = new Map<string, { payload: { normalizedPostcode: string; minutes: number; origin: LonLat; geometry: any }; loadedAtMs: number }>();

function normalizeMinutes(value: number): 15 | 30 | 45 | 60 | null {
  return value === 15 || value === 30 || value === 45 || value === 60 ? value : null;
}

function normalizePostcode(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "").trim();
}

async function lookupPostcodeCoords(postcode: string): Promise<LonLat | null> {
  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  const lon = Number(data?.result?.longitude);
  const lat = Number(data?.result?.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 180);
  } catch {
    return "";
  }
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}