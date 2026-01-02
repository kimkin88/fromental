
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ImageUpload, VisualizerState, Point, Box } from "../types";

// Always create a new instance right before making an API call to ensure it always uses the most up-to-date API key
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

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

  // Convert boxes to lists of points (corners) for the prompt
  const boxesAsPoints = userBoxes.map(box => {
    const x1 = box.start[0];
    const y1 = box.start[1];
    const x2 = box.end[0];
    const y2 = box.end[1];
    return [
      [x1, y1], [x2, y1], [x2, y2], [x1, y2]
    ];
  });

  const prompt = `
    Analyze the uploaded wallpaper design and room photo contextually.
    
    CRITICAL LUXURY ROLL LOGIC:
    - This is a non-repeating panoramic wallpaper.
    - Each "Roll" is exactly ONE unique vertical strip of 70cm width.
    - Strips are printed in sequence (Strip 1, Strip 2, etc.).
    - Partial strips required to cover a section count as ONE FULL unique roll.
    
    1. Spatial Scaling: ${refType === 'A4_paper' ? a4Instruction : doorInstruction}
    2. Region Analysis: I have provided ${userBoxes.length} rectangular bounding boxes where the wallpaper should be applied.
    3. Calculation: 
       - For each rectangular box, determine its maximum horizontal width in real-world cm using the calibration scale.
       - Calculate strips for that region: ceil(Horizontal Width in cm / 70).
       - Sum the strips needed for all regions. This is 'total_rolls_estimated'.
    4. Wallpaper Scan: Scan the wallpaper image for any specific width or numbering info. Default to 70cm per strip if not specified otherwise.
    
    User Boxes (Corners in Normalized 0-100 coordinates): ${JSON.stringify(boxesAsPoints)}

    Return results in this JSON format:
    {
      "calibration": { "reference_type": "${refType}", "real_world_cm": ${refHeight} },
      "wallpaper": { "master_width_cm": 500, "master_height_cm": 300, "roll_width_cm": 70, "roll_length_cm": 300 },
      "regions": [
        { "points": [[x,y], [x,y], [x,y], [x,y]], "width_cm": 0, "height_cm": 0, "area_sq_m": 0 }
      ],
      "total_rolls_estimated": 0
    }
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { inlineData: { data: roomImage.data, mimeType: roomImage.mimeType } },
        { inlineData: { data: wallpaperImage.data, mimeType: wallpaperImage.mimeType } },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          calibration: {
            type: Type.OBJECT,
            properties: {
              reference_type: { type: Type.STRING },
              real_world_cm: { type: Type.NUMBER }
            }
          },
          wallpaper: {
            type: Type.OBJECT,
            properties: {
              master_width_cm: { type: Type.NUMBER },
              master_height_cm: { type: Type.NUMBER },
              roll_width_cm: { type: Type.NUMBER },
              roll_length_cm: { type: Type.NUMBER }
            }
          },
          regions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                points: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } },
                width_cm: { type: Type.NUMBER },
                height_cm: { type: Type.NUMBER },
                area_sq_m: { type: Type.NUMBER }
              }
            }
          },
          total_rolls_estimated: { type: Type.NUMBER }
        },
        required: ["calibration", "wallpaper", "regions", "total_rolls_estimated"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
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
  const regionsJson = JSON.stringify(metadata.regions.map(r => r.points));
  
  const prompt = `
    High-fidelity luxury wallpaper visualization.
    TARGET AREAS: I have defined ${metadata.regions.length} specific rectangular wall regions: ${regionsJson}.
    
    INSTALLATION SPEC:
    - The wallpaper is a sequential panorama of 70cm strips.
    - Render the pattern flowing naturally across the designated blue rectangular regions provided.
    - Ensure correct 3D perspective, depth, and occlusion (wallpaper must sit BEHIND existing furniture/decor).
    - Match room lighting and texture perfectly.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: {
      parts: [
        { inlineData: { data: roomImage.data, mimeType: roomImage.mimeType } },
        { inlineData: { data: wallpaperImage.data, mimeType: wallpaperImage.mimeType } },
        { text: prompt }
      ]
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "1K"
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Visualization synthesis failed");
}
