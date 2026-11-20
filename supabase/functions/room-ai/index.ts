// =====================================================================
//  ADL · room-ai — анализ фото комнаты через Google Gemini
//  Ключ Gemini хранится в секрете GEMINI_API_KEY (на сайте его нет).
// =====================================================================
const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// Модели по порядку: если одна перегружена или недоступна — пробуем следующую
const MODELS = (Deno.env.get("GEMINI_MODELS") ??
  "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-3-flash-preview,gemini-flash-latest").split(",").map((s) => s.trim()).filter(Boolean);

// Модели, которые умеют редактировать фото (убрать мусор и помехи)
const IMAGE_MODELS = (Deno.env.get("GEMINI_IMAGE_MODELS") ??
  "gemini-3.1-flash-image,gemini-2.5-flash-image,gemini-3-pro-image").split(",").map((s) => s.trim()).filter(Boolean);
const CLEAN_PROMPT = "Edit this photo of a room: remove all loose clutter — trash, boxes, bags, clothes, toys, cables, buckets, construction debris, tools, small movable items and movable old furniture — and fill the freed areas with the matching wall and floor so it looks like a clean empty room. Keep EVERYTHING else exactly as it is: the same camera position, framing, perspective, image size and aspect ratio, the same walls, corners, floor, ceiling, windows, doors, radiators, outlets, switches, pipes, lamps, baseboards, colours and lighting. Do not add anything. Do not crop, zoom or rotate. Photorealistic.";

// Разрешённые сайты (через запятую). Пусто = любой.
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const PROMPT = "You are a precise interior-measurement assistant for a custom furniture company. Analyse this photo of a room taken with a phone. The furniture will be placed against the BACK WALL (the wall the camera faces).\n\nAll image coordinates are normalised integers 0..1000: x from the left edge, y from the top edge of the image.\n\nReturn:\n1. back_wall.floor_line: two points ON the line where the back wall meets the floor (left point and right point, as far apart as visible). Follow the bottom edge of the wall, i.e. the bottom of the baseboard, not the top of it.\n2. back_wall.ceiling_line: two points on the line where the back wall meets the ceiling, or null if the ceiling is not visible.\n3. back_wall.left_corner_x / right_corner_x: x of the vertical corners where the back wall meets the left/right side wall, or null if that corner is outside the photo.\n4. left_floor_line / right_floor_line: two points on the line where the LEFT (or RIGHT) side wall meets the floor, or null if not visible.\n5. baseboard: is there a skirting board on the back wall, its approximate height in cm and colour.\n6. obstacles on the back wall or floor near it that affect furniture: windows, doors, radiators, outlets, switches, pipes, air conditioners, columns, niches, existing furniture. Give a tight bounding box for each, a short label IN RUSSIAN (e.g. «окно», «радиатор», «дверь»), and say which surface it is on.\n7. light: where the main light comes from relative to the camera view (left/right/front = from behind the back wall e.g. window in it/behind = from behind the camera/top = ceiling lamps), warmth and overall brightness 0..1.\n8. Estimates in metres: ceiling height (typical 2.5–3.0) and the back wall width, using doors (≈2.0 m high, 0.8–0.9 m wide), outlets (≈0.3 m above floor), windows and baseboards as scale references.\n9. wall_color and floor_color as hex.\n10. advice: 1–2 short sentences IN RUSSIAN for the client: where on this wall furniture fits best and what to avoid (e.g. don't block the radiator, keep the door swing free).\n11. clutter: is there loose clutter that spoils the photo — trash, boxes, bags, clothes, toys, cables, buckets, construction debris, tools, small movable items or movable old furniture standing against the back wall? List them briefly IN RUSSIAN. Do NOT count walls, windows, doors, radiators, outlets, pipes, lamps or built-in elements.\nBe accurate: these points are used to calibrate a 3D camera.";

const SCHEMA = {
  "type": "OBJECT",
  "properties": {
    "clutter": { "type": "OBJECT", "nullable": true, "properties": { "present": { "type": "BOOLEAN" }, "items": { "type": "ARRAY", "items": { "type": "STRING" } } } },
    "back_wall": {
      "type": "OBJECT",
      "properties": {
        "floor_line": {
          "type": "ARRAY",
          "items": {
            "type": "OBJECT",
            "properties": {
              "x": {
                "type": "NUMBER"
              },
              "y": {
                "type": "NUMBER"
              }
            },
            "required": [
              "x",
              "y"
            ]
          }
        },
        "ceiling_line": {
          "type": "ARRAY",
          "nullable": true,
          "items": {
            "type": "OBJECT",
            "properties": {
              "x": {
                "type": "NUMBER"
              },
              "y": {
                "type": "NUMBER"
              }
            },
            "required": [
              "x",
              "y"
            ]
          }
        },
        "left_corner_x": {
          "type": "NUMBER",
          "nullable": true
        },
        "right_corner_x": {
          "type": "NUMBER",
          "nullable": true
        }
      },
      "required": [
        "floor_line"
      ]
    },
    "left_floor_line": {
      "type": "ARRAY",
      "nullable": true,
      "items": {
        "type": "OBJECT",
        "properties": {
          "x": {
            "type": "NUMBER"
          },
          "y": {
            "type": "NUMBER"
          }
        },
        "required": [
          "x",
          "y"
        ]
      }
    },
    "right_floor_line": {
      "type": "ARRAY",
      "nullable": true,
      "items": {
        "type": "OBJECT",
        "properties": {
          "x": {
            "type": "NUMBER"
          },
          "y": {
            "type": "NUMBER"
          }
        },
        "required": [
          "x",
          "y"
        ]
      }
    },
    "baseboard": {
      "type": "OBJECT",
      "properties": {
        "present": {
          "type": "BOOLEAN"
        },
        "height_cm": {
          "type": "NUMBER"
        },
        "color": {
          "type": "STRING"
        }
      },
      "required": [
        "present"
      ]
    },
    "obstacles": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "type": {
            "type": "STRING",
            "enum": [
              "window",
              "door",
              "radiator",
              "outlet",
              "switch",
              "pipe",
              "air_conditioner",
              "column",
              "niche",
              "furniture",
              "other"
            ]
          },
          "label": {
            "type": "STRING"
          },
          "surface": {
            "type": "STRING",
            "enum": [
              "back",
              "left",
              "right",
              "floor",
              "ceiling"
            ]
          },
          "box": {
            "type": "OBJECT",
            "properties": {
              "xmin": {
                "type": "NUMBER"
              },
              "ymin": {
                "type": "NUMBER"
              },
              "xmax": {
                "type": "NUMBER"
              },
              "ymax": {
                "type": "NUMBER"
              }
            },
            "required": [
              "xmin",
              "ymin",
              "xmax",
              "ymax"
            ]
          }
        },
        "required": [
          "type",
          "surface",
          "box"
        ]
      }
    },
    "light": {
      "type": "OBJECT",
      "properties": {
        "main_source": {
          "type": "STRING",
          "enum": [
            "left",
            "right",
            "front",
            "behind",
            "top"
          ]
        },
        "warmth": {
          "type": "STRING",
          "enum": [
            "warm",
            "neutral",
            "cool"
          ]
        },
        "brightness": {
          "type": "NUMBER"
        }
      },
      "required": [
        "main_source",
        "warmth",
        "brightness"
      ]
    },
    "ceiling_height_m": {
      "type": "NUMBER"
    },
    "back_wall_width_m": {
      "type": "NUMBER"
    },
    "wall_color": {
      "type": "STRING"
    },
    "floor_color": {
      "type": "STRING"
    },
    "advice": {
      "type": "STRING"
    }
  },
  "required": [
    "back_wall",
    "baseboard",
    "obstacles",
    "light",
    "ceiling_height_m",
    "back_wall_width_m",
    "advice"
  ]
};

function cors(origin: string | null) {
  const allow = !ALLOWED.length ? "*" : (origin && ALLOWED.some((a) => origin.startsWith(a)) ? origin : ALLOWED[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });

async function ask(model: string, image: string, mime: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: image } }, { text: PROMPT }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          temperature: 0.2,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    });
    if (!r.ok) return { retry: [404, 408, 429, 500, 502, 503, 504].includes(r.status), error: `${model}: ${r.status}` };
    const d = await r.json();
    const parts = d?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought).map((p: { text: string }) => p.text).join("");
    return { data: JSON.parse(text), model };
  } catch (e) {
    return { retry: true, error: `${model}: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function clean(model: string, image: string, mime: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: image } }, { text: CLEAN_PROMPT }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], temperature: 0.2 },
      }),
    });
    if (!r.ok) return { retry: [400, 404, 408, 429, 500, 502, 503, 504].includes(r.status), error: `${model}: ${r.status}` };
    const d = await r.json();
    const parts = d?.candidates?.[0]?.content?.parts ?? [];
    const img = parts.map((p: Record<string, any>) => p.inline_data ?? p.inlineData).find((x: any) => x?.data);
    if (!img) return { retry: true, error: `${model}: no image` };
    return { image: img.data as string, mime: (img.mime_type ?? img.mimeType ?? "image/png") as string, model };
  } catch (e) {
    return { retry: true, error: `${model}: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "method" }, 405, h);
  if (!KEY) return json({ error: "GEMINI_API_KEY не задан" }, 500, h);
  if (ALLOWED.length && !ALLOWED.some((a) => (req.headers.get("origin") ?? "").startsWith(a))) return json({ error: "origin" }, 403, h);

  let body: { image?: string; mime?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const image = body.image ?? "";
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(body.mime ?? "") ? body.mime! : "image/jpeg";
  if (!image || image.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return json({ error: "image" }, 400, h);

  const errors: string[] = [];
  if (body.action === "clean") {
    for (const m of IMAGE_MODELS) {
      const res = await clean(m, image, mime);
      if (res.image) return json({ ok: true, model: res.model, image: res.image, mime: res.mime }, 200, h);
      errors.push(res.error!);
      if (!res.retry) break;
    }
    return json({ ok: false, error: "Не удалось очистить фото", details: errors }, 503, h);
  }
  for (const m of MODELS) {
    const res = await ask(m, image, mime);
    if (res.data) return json({ ok: true, model: res.model, result: res.data }, 200, h);
    errors.push(res.error!);
    if (!res.retry) break;
  }
  return json({ ok: false, error: "Сервис ИИ временно недоступен", details: errors }, 503, h);
});
