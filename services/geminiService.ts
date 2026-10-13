import { GoogleGenAI, Type } from "@google/genai";
import { ImageUpload, VisualizerState, Point, Box, ReferenceType } from "../types";

// Always create a new instance right before making an API call to ensure it always uses the most up-to-date API key
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

function boxToPoints(box: Box): Point[] {
  const x1 = Number(box.start[0].toFixed(2));
  const y1 = Number(box.start[1].toFixed(2));
  const x2 = Number(box.end[0].toFixed(2));
  const y2 = Number(box.end[1].toFixed(2));
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

function parseModelJson(raw: string): Record<string, unknown> {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    throw new Error(`Model returned invalid JSON (${message})`);
  }
}

/**
 * Analyzes the room photo based on user-marked rectangular boxes to calculate exact dimensions.
 */
export async function analyzeMarkedRegions(
  roomImage: ImageUpload,
  wallpaperImage: ImageUpload,
  refType: string,
  refHeight: number,
  userBoxes: Box[]
): Promise<VisualizerState> {
  const ai = getAI();

  const doorInstruction = `Identify the door leaf (the movable part) in the image. Its height is exactly ${refHeight}cm. Use this object to calibrate the scale (pixels per cm).`;
  const a4Instruction = `Identify the white A4 paper sheet. Its long edge is exactly 29.7cm. Use this to calibrate the scale (pixels per cm).`;

  // Compact box list — do NOT ask the model to echo coordinates back (that truncates JSON).
  const boxesAsPoints = userBoxes.map(boxToPoints);

  const prompt = `
Analyze the uploaded wallpaper design and room photo.

CRITICAL LUXURY ROLL LOGIC:
- Non-repeating panoramic wallpaper.
- Each "Roll" is ONE unique vertical strip of 70cm width.
- Partial strips count as ONE FULL roll.

1. Spatial Scaling: ${refType === "A4_paper" ? a4Instruction : doorInstruction}
2. I provided ${userBoxes.length} rectangular regions (normalized 0-100 coords): ${JSON.stringify(boxesAsPoints)}
3. For EACH region in order, estimate width_cm, height_cm, area_sq_m, and rolls_needed = ceil(width_cm / 70).
4. total_rolls_estimated = sum of rolls_needed.
5. Wallpaper defaults: roll_width_cm=70 unless the design image clearly states otherwise.

Return ONLY compact JSON. Do not include points/coordinates. regions[] must have exactly ${userBoxes.length} items in the same order as the boxes above.
`.trim();

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: {
      parts: [
        { inlineData: { data: roomImage.data, mimeType: roomImage.mimeType } },
        { inlineData: { data: wallpaperImage.data, mimeType: wallpaperImage.mimeType } },
        { text: prompt },
      ],
    },
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          calibration: {
            type: Type.OBJECT,
            properties: {
              reference_type: { type: Type.STRING },
              real_world_cm: { type: Type.NUMBER },
            },
            required: ["reference_type", "real_world_cm"],
          },
          wallpaper: {
            type: Type.OBJECT,
            properties: {
              master_width_cm: { type: Type.NUMBER },
              master_height_cm: { type: Type.NUMBER },
              roll_width_cm: { type: Type.NUMBER },
              roll_length_cm: { type: Type.NUMBER },
            },
            required: ["master_width_cm", "master_height_cm", "roll_width_cm", "roll_length_cm"],
          },
          regions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                width_cm: { type: Type.NUMBER },
                height_cm: { type: Type.NUMBER },
                area_sq_m: { type: Type.NUMBER },
                rolls_needed: { type: Type.NUMBER },
              },
              required: ["width_cm", "height_cm", "area_sq_m", "rolls_needed"],
            },
          },
          total_rolls_estimated: { type: Type.NUMBER },
        },
        required: ["calibration", "wallpaper", "regions", "total_rolls_estimated"],
      },
    },
  });

  const parsed = parseModelJson(response.text || "{}") as {
    calibration?: { reference_type?: string; real_world_cm?: number };
    wallpaper?: {
      master_width_cm?: number;
      master_height_cm?: number;
      roll_width_cm?: number;
      roll_length_cm?: number;
    };
    regions?: Array<{
      width_cm?: number;
      height_cm?: number;
      area_sq_m?: number;
      rolls_needed?: number;
    }>;
    total_rolls_estimated?: number;
  };

  const modelRegions = Array.isArray(parsed.regions) ? parsed.regions : [];
  const regions = userBoxes.map((box, i) => {
    const measured = modelRegions[i] || {};
    return {
      points: boxToPoints(box),
      width_cm: Number(measured.width_cm) || 0,
      height_cm: Number(measured.height_cm) || 0,
      area_sq_m: Number(measured.area_sq_m) || 0,
    };
  });

  const rollsFromRegions = modelRegions.reduce(
    (sum, r) => sum + (Number(r?.rolls_needed) || 0),
    0,
  );

  return {
    calibration: {
      reference_type: (parsed.calibration?.reference_type as ReferenceType) || (refType as ReferenceType),
      real_world_cm: Number(parsed.calibration?.real_world_cm) || refHeight,
    },
    wallpaper: {
      master_width_cm: Number(parsed.wallpaper?.master_width_cm) || 500,
      master_height_cm: Number(parsed.wallpaper?.master_height_cm) || 300,
      roll_width_cm: Number(parsed.wallpaper?.roll_width_cm) || 70,
      roll_length_cm: Number(parsed.wallpaper?.roll_length_cm) || 300,
    },
    regions,
    total_rolls_estimated:
      Number(parsed.total_rolls_estimated) || Math.max(1, Math.round(rollsFromRegions)) || 1,
  };
}

/**
 * Generates the photorealistic preview specifically applied to the user's masked regions.
 */
export async function generateMaskedVisualization(
  roomImage: ImageUpload,
  wallpaperImage: ImageUpload,
  metadata: VisualizerState
): Promise<string> {
  const ai = getAI();
  const regionsJson = JSON.stringify(metadata.regions.map((r) => r.points));

  const prompt = `
High-fidelity luxury wallpaper visualization.
TARGET AREAS: ${metadata.regions.length} rectangular wall regions (normalized 0-100): ${regionsJson}.

INSTALLATION SPEC:
- Sequential panorama of 70cm strips.
- Apply pattern only inside the designated rectangular regions.
- Correct 3D perspective, depth, and occlusion (wallpaper behind furniture/decor).
- Match room lighting and texture.
`.trim();

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: {
      parts: [
        { inlineData: { data: roomImage.data, mimeType: roomImage.mimeType } },
        { inlineData: { data: wallpaperImage.data, mimeType: wallpaperImage.mimeType } },
        { text: prompt },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "1K",
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType || "image/png";
      return `data:${mime};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Visualization synthesis failed — model returned no image");
}
