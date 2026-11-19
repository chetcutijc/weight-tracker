// analyze-meal: takes a meal photo, returns an itemised calorie/macro estimate from Claude.
// Secrets: ANTHROPIC_API_KEY (required), ALLOWED_EMAILS (optional, comma-separated), MEAL_MODEL (optional)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("MEAL_MODEL") ?? "claude-sonnet-5-5";
const MAX_B64 = 7_000_000; // ~5 MB image

const TOOL = {
  name: "log_meal",
  description: "Record the identified meal with per-item portion and nutrition estimates.",
  input_schema: {
    type: "object",
    properties: {
      is_food: { type: "boolean", description: "False if the photo does not show food or drink." },
      name: { type: "string", description: "Short name for the whole meal, e.g. 'Chicken Caesar salad'." },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            portion: { type: "string", description: "Human portion, e.g. '1 cup', '2 slices'." },
            grams: { type: "number" },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
          },
          required: ["name", "portion", "grams", "calories", "protein_g", "carbs_g", "fat_g"],
        },
      },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      notes: { type: "string", description: "Main uncertainties: hidden oil, sauce, portion size, etc." },
    },
    required: ["is_food", "name", "items", "confidence", "notes"],
  },
};

const PROMPT = `Identify this meal and estimate its nutrition.
- List each distinct component separately (include visible oils, dressings, sauces, drinks).
- Estimate grams from visual cues (plate ~26 cm, fork, hand, packaging). Be realistic, not optimistic: restaurant and home-cooked food usually contains more fat than it looks.
- Use standard nutrition values (USDA-style) for calories and macros.
- Confidence: "high" only for packaged/simple foods with clear portions; "low" if the portion or ingredients are hard to see.
- The user is in Malta; local dishes (pastizzi, ftira, ħobż biż-żejt, rabbit stew, timpana) are plausible.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Require a real signed-in user (the anon key alone is not enough).
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return json({ error: "Not signed in" }, 401);
  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes((user.email ?? "").toLowerCase())) return json({ error: "Not allowed" }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY secret is not set" }, 500);

  let body: { image_base64?: string; media_type?: string; hint?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { image_base64, media_type = "image/jpeg", hint } = body;
  if (!image_base64 || typeof image_base64 !== "string") return json({ error: "image_base64 required" }, 400);
  if (image_base64.length > MAX_B64) return json({ error: "Image too large" }, 413);
  if (!["image/jpeg", "image/png", "image/webp"].includes(media_type)) return json({ error: "Unsupported image type" }, 400);

  const text = hint ? `${PROMPT}\n\nUser's note about this meal (trust it over the photo): ${String(hint).slice(0, 500)}` : PROMPT;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "log_meal" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: image_base64 } },
          { type: "text", text },
        ],
      }],
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error("Anthropic error", r.status, detail);
    return json({ error: `Claude API error ${r.status}` }, 502);
  }
  const out = await r.json();
  const call = (out.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!call) return json({ error: "No structured result" }, 502);

  const res = call.input;
  const sum = (k: string) => Math.round((res.items ?? []).reduce((a: number, i: Record<string, number>) => a + (Number(i[k]) || 0), 0) * 10) / 10;
  res.totals = {
    calories: Math.round(sum("calories")),
    protein_g: sum("protein_g"),
    carbs_g: sum("carbs_g"),
    fat_g: sum("fat_g"),
  };
  res.model = MODEL;
  return json(res);
});
