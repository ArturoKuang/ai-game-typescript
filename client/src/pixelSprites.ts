import { CanvasSource, Texture } from "pixi.js";
import type { Orientation } from "./types.js";

export type ActorAnimationState = "idle" | "walk" | "talk";

export interface ActorTextureSet {
  idle: Record<Orientation, Texture[]>;
  walk: Record<Orientation, Texture[]>;
  talk: Record<Orientation, Texture[]>;
}

export interface EntityTextureSet {
  frames: Texture[];
  anchorY: number;
}

export interface TerrainTextureSet {
  grass: Texture[];
  dirt: Texture[];
  cobble: Texture[];
  track: Texture[];
  tilled: Texture[];
  water: Texture[];
}

export interface FarmhouseTextureSet {
  base: Texture;
  roof: Texture;
}

const SKIN_TONES = ["#f1d3b3", "#d8aa7d", "#b9845e", "#8d5d3d"];
const HAIR_TONES = [
  "#3a2a1d",
  "#70472b",
  "#d7a441",
  "#6f3a1d",
  "#2b5c45",
  "#9d542d",
];
const SHIRT_TONES = [
  "#4d86c8",
  "#6aa84f",
  "#d08c3f",
  "#b04d62",
  "#5c72d6",
  "#4fb3a8",
];
const PANTS_TONES = ["#4a5a6b", "#5b4e7a", "#5a4337", "#335f73"];
const BOOT_TONES = ["#3f2e24", "#564133", "#2d2d2d"];

type PixelRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(values: readonly T[], seed: number, shift: number): T {
  return values[(seed >> shift) % values.length];
}

function makeTexture(
  width: number,
  height: number,
  rects: PixelRect[],
): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context unavailable");
  }

  context.clearRect(0, 0, width, height);
  for (const rect of rects) {
    context.fillStyle = rect.color;
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  return new Texture({
    source: new CanvasSource({
      resource: canvas,
      scaleMode: "nearest",
    }),
  });
}

function actorPalette(
  seed: number,
  isNpc: boolean,
): {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  boots: string;
  accent: string;
} {
  return {
    skin: pick(SKIN_TONES, seed, 1),
    hair: pick(HAIR_TONES, seed, 4),
    shirt: isNpc
      ? pick(SHIRT_TONES, seed, 7)
      : pick(SHIRT_TONES, seed ^ 0x3f, 10),
    pants: pick(PANTS_TONES, seed, 13),
    boots: pick(BOOT_TONES, seed, 16),
    accent: pick(["#f7e27c", "#d7f0a9", "#f4c3d4", "#a9dcff"], seed, 19),
  };
}

function createActorFrame(
  palette: ReturnType<typeof actorPalette>,
  orientation: Orientation,
  frameIndex: number,
  animationState: ActorAnimationState,
): Texture {
  const rects: PixelRect[] = [];
  const bob = animationState === "idle" ? 0 : frameIndex === 1 ? 1 : 0;
  const talkRaisedArm = animationState === "talk";

  rects.push({ x: 4, y: 13, w: 8, h: 2, color: "#00000033" });

  if (orientation === "down") {
    rects.push({ x: 5, y: 2 + bob, w: 6, h: 4, color: palette.skin });
    rects.push({ x: 4, y: 1 + bob, w: 8, h: 2, color: palette.hair });
    rects.push({ x: 5, y: 6 + bob, w: 6, h: 4, color: palette.shirt });
    rects.push({
      x: 4,
      y: 6 + bob,
      w: 1,
      h: talkRaisedArm ? 2 : 3,
      color: palette.skin,
    });
    rects.push({
      x: 11,
      y: 6 + bob,
      w: 1,
      h: talkRaisedArm ? 2 : 3,
      color: palette.skin,
    });
    rects.push({
      x: 5,
      y: 10 + bob,
      w: 2,
      h: frameIndex === 0 ? 3 : 4,
      color: palette.pants,
    });
    rects.push({
      x: 9,
      y: 10 + bob,
      w: 2,
      h: frameIndex === 2 ? 3 : 4,
      color: palette.pants,
    });
    rects.push({ x: 5, y: 14, w: 2, h: 1, color: palette.boots });
    rects.push({ x: 9, y: 14, w: 2, h: 1, color: palette.boots });
    rects.push({ x: 7, y: 7 + bob, w: 2, h: 2, color: palette.accent });
  } else if (orientation === "up") {
    rects.push({ x: 5, y: 2 + bob, w: 6, h: 4, color: palette.hair });
    rects.push({ x: 5, y: 4 + bob, w: 6, h: 2, color: palette.skin });
    rects.push({ x: 5, y: 6 + bob, w: 6, h: 4, color: palette.shirt });
    rects.push({
      x: 4,
      y: 6 + bob,
      w: 1,
      h: talkRaisedArm ? 2 : 3,
      color: palette.skin,
    });
    rects.push({
      x: 11,
      y: 6 + bob,
      w: 1,
      h: talkRaisedArm ? 2 : 3,
      color: palette.skin,
    });
    rects.push({
      x: 5,
      y: 10 + bob,
      w: 2,
      h: frameIndex === 0 ? 3 : 4,
      color: palette.pants,
    });
    rects.push({
      x: 9,
      y: 10 + bob,
      w: 2,
      h: frameIndex === 2 ? 3 : 4,
      color: palette.pants,
    });
    rects.push({ x: 5, y: 14, w: 2, h: 1, color: palette.boots });
    rects.push({ x: 9, y: 14, w: 2, h: 1, color: palette.boots });
  } else {
    const facingRight = orientation === "right";
    const headX = facingRight ? 6 : 5;
    const armX = facingRight ? 10 : 4;
    const legFrontX = facingRight ? 8 : 6;
    const legBackX = facingRight ? 6 : 8;
    rects.push({ x: headX, y: 2 + bob, w: 4, h: 4, color: palette.skin });
    rects.push({ x: headX - 1, y: 1 + bob, w: 4, h: 2, color: palette.hair });
    rects.push({ x: 5, y: 6 + bob, w: 6, h: 4, color: palette.shirt });
    rects.push({
      x: armX,
      y: 7 + bob - (talkRaisedArm ? 2 : 0),
      w: 1,
      h: 3,
      color: palette.skin,
    });
    rects.push({
      x: legBackX,
      y: 10 + bob,
      w: 2,
      h: frameIndex === 1 ? 3 : 4,
      color: palette.pants,
    });
    rects.push({
      x: legFrontX,
      y: 10 + bob,
      w: 2,
      h: frameIndex === 2 ? 3 : 4,
      color: palette.pants,
    });
    rects.push({ x: legBackX, y: 14, w: 2, h: 1, color: palette.boots });
    rects.push({ x: legFrontX, y: 14, w: 2, h: 1, color: palette.boots });
    rects.push({
      x: facingRight ? 9 : 5,
      y: 7 + bob,
      w: 1,
      h: 2,
      color: palette.accent,
    });
  }

  return makeTexture(16, 16, rects);
}

function createBearFrame(
  orientation: Orientation,
  frameIndex: number,
): Texture {
  const bob = frameIndex === 1 ? 1 : 0;
  const fur = "#7b4a2f";
  const shadow = "#5a301c";
  const muzzle = "#d8b18a";
  const rects: PixelRect[] = [
    { x: 2, y: 13, w: 12, h: 2, color: "#00000033" },
    { x: 3, y: 5 + bob, w: 10, h: 7, color: fur },
    { x: 5, y: 2 + bob, w: 6, h: 5, color: fur },
    { x: 4, y: 1 + bob, w: 2, h: 2, color: fur },
    { x: 10, y: 1 + bob, w: 2, h: 2, color: fur },
    { x: 6, y: 5 + bob, w: 4, h: 3, color: muzzle },
    { x: 7, y: 6 + bob, w: 2, h: 1, color: shadow },
  ];

  if (orientation === "left" || orientation === "right") {
    rects.push({
      x: orientation === "right" ? 10 : 4,
      y: 6 + bob,
      w: 2,
      h: 2,
      color: muzzle,
    });
  }

  rects.push({
    x: 4,
    y: 11 + bob,
    w: 2,
    h: frameIndex === 0 ? 2 : 3,
    color: shadow,
  });
  rects.push({
    x: 10,
    y: 11 + bob,
    w: 2,
    h: frameIndex === 2 ? 2 : 3,
    color: shadow,
  });

  return makeTexture(16, 16, rects);
}

function createBerryBushTexture(berryColor: string): Texture {
  return makeTexture(16, 16, [
    { x: 2, y: 9, w: 12, h: 2, color: "#0000002a" },
    { x: 3, y: 4, w: 10, h: 7, color: "#5fa646" },
    { x: 2, y: 6, w: 12, h: 5, color: "#77c155" },
    { x: 5, y: 5, w: 2, h: 2, color: berryColor },
    { x: 10, y: 6, w: 2, h: 2, color: berryColor },
    { x: 7, y: 8, w: 2, h: 2, color: berryColor },
  ]);
}

function createBenchTexture(): Texture {
  return makeTexture(16, 16, [
    { x: 3, y: 11, w: 10, h: 2, color: "#0000002a" },
    { x: 3, y: 5, w: 10, h: 2, color: "#a86c3f" },
    { x: 3, y: 8, w: 10, h: 2, color: "#c88853" },
    { x: 4, y: 4, w: 1, h: 6, color: "#7a4a2c" },
    { x: 11, y: 4, w: 1, h: 6, color: "#7a4a2c" },
  ]);
}

function createCampfireFrames(): Texture[] {
  const logColor = "#7a4a2c";
  const flameA = "#f7c95a";
  const flameB = "#ef7d36";
  return [
    makeTexture(16, 16, [
      { x: 4, y: 12, w: 8, h: 2, color: "#0000002a" },
      { x: 5, y: 10, w: 6, h: 1, color: logColor },
      { x: 6, y: 8, w: 4, h: 3, color: flameB },
      { x: 7, y: 6, w: 2, h: 3, color: flameA },
    ]),
    makeTexture(16, 16, [
      { x: 4, y: 12, w: 8, h: 2, color: "#0000002a" },
      { x: 5, y: 10, w: 6, h: 1, color: logColor },
      { x: 6, y: 9, w: 4, h: 2, color: flameB },
      { x: 7, y: 5, w: 2, h: 4, color: flameA },
    ]),
  ];
}

function createRawFoodTexture(): Texture {
  return makeTexture(16, 16, [
    { x: 4, y: 11, w: 8, h: 2, color: "#00000025" },
    { x: 4, y: 6, w: 3, h: 3, color: "#cc4156" },
    { x: 6, y: 8, w: 3, h: 3, color: "#dd5b74" },
    { x: 8, y: 6, w: 3, h: 3, color: "#cc4156" },
    { x: 7, y: 4, w: 1, h: 2, color: "#5ea642" },
  ]);
}

function createCookedFoodTexture(): Texture {
  return makeTexture(16, 16, [
    { x: 4, y: 11, w: 8, h: 2, color: "#00000025" },
    { x: 4, y: 8, w: 8, h: 2, color: "#d9d3c7" },
    { x: 5, y: 6, w: 6, h: 3, color: "#d28d43" },
    { x: 6, y: 5, w: 1, h: 1, color: "#87b34d" },
    { x: 9, y: 5, w: 1, h: 1, color: "#d14c62" },
  ]);
}

function createGrassTileTexture(variant: number): Texture {
  const bases = ["#7bad3d", "#75a53a", "#7eaf42", "#719f36"];
  const mids = ["#6b9932", "#668f31", "#719b39", "#5f8b2e"];
  const highs = ["#95c853", "#8dc14f", "#9acd58", "#87bb4a"];
  const petals = ["#f3e79d", "#d7f0a9", "#f5c0d0", "#a9dff7"];

  return makeTexture(16, 16, [
    { x: 0, y: 0, w: 16, h: 16, color: bases[variant % bases.length] },
    { x: 0, y: 11, w: 16, h: 5, color: mids[variant % mids.length] },
    { x: 2, y: 2, w: 4, h: 3, color: highs[variant % highs.length] },
    { x: 9, y: 3, w: 3, h: 2, color: highs[(variant + 1) % highs.length] },
    { x: 5, y: 8, w: 5, h: 2, color: highs[(variant + 2) % highs.length] },
    { x: 12, y: 10, w: 2, h: 3, color: mids[(variant + 1) % mids.length] },
    { x: 1, y: 6, w: 2, h: 4, color: mids[(variant + 2) % mids.length] },
    { x: 7, y: 12, w: 3, h: 2, color: "#5b862a" },
    { x: 10, y: 6, w: 1, h: 1, color: petals[variant % petals.length] },
    { x: 11, y: 7, w: 1, h: 1, color: petals[(variant + 1) % petals.length] },
  ]);
}

function createDirtTileTexture(variant: number): Texture {
  const bases = ["#ad7241", "#b87b47", "#a46939"];
  const mids = ["#91562f", "#9a6035", "#87502b"];
  const highs = ["#cb9561", "#d3a16d", "#bf8554"];

  return makeTexture(16, 16, [
    { x: 0, y: 0, w: 16, h: 16, color: bases[variant % bases.length] },
    { x: 0, y: 11, w: 16, h: 5, color: mids[variant % mids.length] },
    { x: 2, y: 2, w: 5, h: 2, color: highs[variant % highs.length] },
    { x: 8, y: 4, w: 4, h: 2, color: highs[(variant + 1) % highs.length] },
    { x: 4, y: 8, w: 3, h: 2, color: mids[(variant + 1) % mids.length] },
    { x: 11, y: 9, w: 2, h: 2, color: mids[(variant + 2) % mids.length] },
    { x: 6, y: 12, w: 3, h: 2, color: "#744224" },
    { x: 12, y: 6, w: 1, h: 1, color: "#ead2a4" },
    { x: 3, y: 10, w: 1, h: 1, color: "#ead2a4" },
  ]);
}

function createWaterTileTexture(variant: number): Texture {
  const bases = ["#61b8d4", "#58aecc"];
  const depths = ["#4793b4", "#4187a8"];
  const foam = ["#d8f2f8", "#c6ebf5"];

  return makeTexture(16, 16, [
    { x: 0, y: 0, w: 16, h: 16, color: bases[variant % bases.length] },
    { x: 0, y: 11, w: 16, h: 5, color: depths[variant % depths.length] },
    { x: 3, y: 3, w: 4, h: 1, color: foam[variant % foam.length] },
    { x: 9, y: 5, w: 3, h: 1, color: foam[(variant + 1) % foam.length] },
    { x: 5, y: 9, w: 4, h: 1, color: foam[variant % foam.length] },
    { x: 11, y: 12, w: 2, h: 1, color: depths[(variant + 1) % depths.length] },
  ]);
}

function createCobbleTileTexture(variant: number): Texture {
  const base = ["#b3a58f", "#b9ac98", "#a99c88"][variant % 3];
  const shade = ["#8a7e6c", "#928674", "#817565"][variant % 3];
  const light = ["#d6cab8", "#ded2bf", "#cfc2af"][variant % 3];

  return makeTexture(16, 16, [
    { x: 0, y: 0, w: 16, h: 16, color: base },
    { x: 1, y: 2, w: 5, h: 4, color: shade },
    { x: 6, y: 1, w: 4, h: 5, color: light },
    { x: 10, y: 3, w: 5, h: 4, color: shade },
    { x: 2, y: 8, w: 4, h: 4, color: light },
    { x: 7, y: 7, w: 4, h: 5, color: shade },
    { x: 11, y: 9, w: 3, h: 4, color: light },
    { x: 0, y: 12, w: 16, h: 4, color: "#8a7d6b" },
    { x: 5, y: 6, w: 1, h: 6, color: "#6f6457" },
    { x: 10, y: 7, w: 1, h: 5, color: "#6f6457" },
  ]);
}

function createTrackTileTexture(variant: number): Texture {
  const base = ["#a87a4b", "#b18352", "#a37447"][variant % 3];
  const shade = ["#84582f", "#8c5f34", "#7e532d"][variant % 3];
  const grass = ["#84b64d", "#91c35a", "#79aa44"][variant % 3];

  return makeTexture(16, 16, [
    { x: 0, y: 0, w: 16, h: 16, color: "#78a53d" },
    { x: 1, y: 4, w: 14, h: 7, color: base },
    { x: 0, y: 11, w: 16, h: 5, color: "#6c9634" },
    { x: 2, y: 5, w: 12, h: 2, color: "#c89b68" },
    { x: 3, y: 8, w: 10, h: 2, color: shade },
    { x: 0, y: 2, w: 2, h: 4, color: grass },
    { x: 14, y: 3, w: 2, h: 4, color: grass },
    { x: 1, y: 12, w: 2, h: 3, color: grass },
    { x: 13, y: 12, w: 2, h: 3, color: grass },
    { x: 7, y: 2, w: 1, h: 1, color: "#f0d38f" },
  ]);
}

function createTilledTileTexture(variant: number): Texture {
  const base = ["#93592f", "#9a6034", "#8a522b"][variant % 3];
  const furrow = ["#6f3f21", "#764526", "#64371d"][variant % 3];
  const straw = ["#d4b36d", "#c8a45f", "#debc79"][variant % 3];

  return makeTexture(16, 16, [
    { x: 0, y: 0, w: 16, h: 16, color: base },
    { x: 0, y: 11, w: 16, h: 5, color: furrow },
    { x: 2, y: 0, w: 2, h: 16, color: furrow },
    { x: 7, y: 0, w: 2, h: 16, color: furrow },
    { x: 12, y: 0, w: 2, h: 16, color: furrow },
    { x: 4, y: 3, w: 2, h: 1, color: straw },
    { x: 9, y: 5, w: 2, h: 1, color: straw },
    { x: 13, y: 8, w: 1, h: 2, color: straw },
    { x: 5, y: 10, w: 2, h: 1, color: "#b97c47" },
  ]);
}

function createBearMeatTexture(): Texture {
  return makeTexture(16, 16, [
    { x: 4, y: 11, w: 8, h: 2, color: "#00000025" },
    { x: 5, y: 6, w: 6, h: 4, color: "#b64d4d" },
    { x: 7, y: 5, w: 4, h: 2, color: "#d89d8f" },
  ]);
}

function createPicnicBlanketTexture(): Texture {
  return makeTexture(24, 16, [
    { x: 2, y: 12, w: 20, h: 2, color: "#00000025" },
    { x: 2, y: 4, w: 20, h: 8, color: "#cf6a62" },
    { x: 4, y: 4, w: 4, h: 8, color: "#f3dfc3" },
    { x: 12, y: 4, w: 4, h: 8, color: "#f3dfc3" },
    { x: 2, y: 6, w: 20, h: 2, color: "#f3dfc3" },
    { x: 2, y: 9, w: 20, h: 2, color: "#f3dfc3" },
    { x: 17, y: 6, w: 4, h: 3, color: "#9b6a3e" },
    { x: 18, y: 5, w: 2, h: 1, color: "#c99b5a" },
  ]);
}

function createMarketStallTexture(): Texture {
  return makeTexture(32, 28, [
    { x: 4, y: 24, w: 24, h: 3, color: "#00000025" },
    { x: 6, y: 9, w: 2, h: 13, color: "#8a5b35" },
    { x: 24, y: 9, w: 2, h: 13, color: "#8a5b35" },
    { x: 4, y: 13, w: 24, h: 4, color: "#d37a6a" },
    { x: 4, y: 9, w: 4, h: 4, color: "#f5e4bf" },
    { x: 8, y: 9, w: 4, h: 4, color: "#d37a6a" },
    { x: 12, y: 9, w: 4, h: 4, color: "#f5e4bf" },
    { x: 16, y: 9, w: 4, h: 4, color: "#d37a6a" },
    { x: 20, y: 9, w: 4, h: 4, color: "#f5e4bf" },
    { x: 24, y: 9, w: 4, h: 4, color: "#d37a6a" },
    { x: 6, y: 17, w: 20, h: 6, color: "#9c653f" },
    { x: 7, y: 18, w: 7, h: 4, color: "#d0a458" },
    { x: 15, y: 18, w: 6, h: 4, color: "#ae635f" },
    { x: 22, y: 18, w: 3, h: 4, color: "#7b4b28" },
    { x: 9, y: 6, w: 2, h: 2, color: "#84bd54" },
    { x: 14, y: 6, w: 2, h: 2, color: "#f0c85e" },
    { x: 19, y: 6, w: 2, h: 2, color: "#a6d5ef" },
  ]);
}

function createGardenPatchTexture(variant: number): Texture {
  const sproutA = variant === 0 ? "#7eb34b" : "#6fa341";
  const sproutB = variant === 0 ? "#9aca61" : "#8ec557";
  return makeTexture(24, 16, [
    { x: 1, y: 12, w: 22, h: 2, color: "#00000020" },
    { x: 2, y: 3, w: 8, h: 5, color: "#8c572f" },
    { x: 14, y: 3, w: 8, h: 5, color: "#8c572f" },
    { x: 2, y: 9, w: 8, h: 5, color: "#945f35" },
    { x: 14, y: 9, w: 8, h: 5, color: "#945f35" },
    { x: 4, y: 4, w: 2, h: 4, color: sproutA },
    { x: 6, y: 3, w: 2, h: 5, color: sproutB },
    { x: 16, y: 4, w: 2, h: 4, color: sproutA },
    { x: 18, y: 3, w: 2, h: 5, color: sproutB },
    { x: 4, y: 10, w: 2, h: 4, color: sproutA },
    { x: 6, y: 9, w: 2, h: 5, color: sproutB },
    { x: 16, y: 10, w: 2, h: 4, color: sproutA },
    { x: 18, y: 9, w: 2, h: 5, color: sproutB },
  ]);
}

function createLanternFrames(): Texture[] {
  return [
    makeTexture(16, 24, [
      { x: 4, y: 20, w: 8, h: 2, color: "#00000025" },
      { x: 7, y: 6, w: 2, h: 14, color: "#714b2f" },
      { x: 5, y: 4, w: 6, h: 5, color: "#efcf7a" },
      { x: 6, y: 5, w: 4, h: 3, color: "#fff1bd" },
    ]),
    makeTexture(16, 24, [
      { x: 4, y: 20, w: 8, h: 2, color: "#00000025" },
      { x: 7, y: 6, w: 2, h: 14, color: "#714b2f" },
      { x: 5, y: 4, w: 6, h: 5, color: "#f4da8a" },
      { x: 6, y: 5, w: 4, h: 3, color: "#fff6cf" },
    ]),
  ];
}

function createMailboxTexture(): Texture {
  return makeTexture(16, 16, [
    { x: 4, y: 13, w: 8, h: 2, color: "#00000025" },
    { x: 7, y: 7, w: 2, h: 6, color: "#7a5232" },
    { x: 4, y: 4, w: 8, h: 5, color: "#6b8cb6" },
    { x: 5, y: 5, w: 6, h: 3, color: "#89abd4" },
    { x: 11, y: 4, w: 1, h: 4, color: "#d6525f" },
  ]);
}

function createFlowerBedTexture(variant: number): Texture {
  const flowerA = variant === 0 ? "#f27fa1" : "#f2c46a";
  const flowerB = variant === 0 ? "#f7d6e0" : "#f5ebc7";
  return makeTexture(16, 12, [
    { x: 1, y: 10, w: 14, h: 2, color: "#00000022" },
    { x: 2, y: 7, w: 12, h: 3, color: "#8d5b34" },
    { x: 3, y: 4, w: 2, h: 4, color: "#7cb34d" },
    { x: 6, y: 3, w: 2, h: 5, color: "#88c458" },
    { x: 10, y: 4, w: 2, h: 4, color: "#7cb34d" },
    { x: 3, y: 2, w: 2, h: 2, color: flowerA },
    { x: 6, y: 1, w: 2, h: 2, color: flowerB },
    { x: 10, y: 2, w: 2, h: 2, color: flowerA },
  ]);
}

function createPondReedsTexture(): Texture {
  return makeTexture(16, 16, [
    { x: 2, y: 13, w: 12, h: 2, color: "#00000020" },
    { x: 3, y: 7, w: 2, h: 6, color: "#7ba746" },
    { x: 6, y: 5, w: 2, h: 8, color: "#8fbe55" },
    { x: 9, y: 6, w: 2, h: 7, color: "#78a145" },
    { x: 12, y: 8, w: 2, h: 5, color: "#89b84d" },
    { x: 3, y: 6, w: 2, h: 2, color: "#b27c46" },
    { x: 9, y: 5, w: 2, h: 2, color: "#b27c46" },
  ]);
}

function createWoodStackTexture(): Texture {
  return makeTexture(24, 16, [
    { x: 2, y: 13, w: 20, h: 2, color: "#00000024" },
    { x: 3, y: 7, w: 18, h: 5, color: "#8c5d38" },
    { x: 4, y: 8, w: 16, h: 3, color: "#ad7c4e" },
    { x: 5, y: 6, w: 4, h: 6, color: "#d7a468" },
    { x: 10, y: 6, w: 4, h: 6, color: "#cf995d" },
    { x: 15, y: 6, w: 4, h: 6, color: "#d7a468" },
    { x: 5, y: 4, w: 2, h: 3, color: "#714a2d" },
    { x: 17, y: 4, w: 2, h: 3, color: "#714a2d" },
    { x: 8, y: 6, w: 1, h: 6, color: "#6c4329" },
    { x: 15, y: 6, w: 1, h: 6, color: "#6c4329" },
  ]);
}

function createPorchCrateTexture(variant: number): Texture {
  const accent = variant === 0 ? "#d37a6a" : "#8cb46b";
  const accentHighlight = variant === 0 ? "#f1b49e" : "#bfd88c";

  return makeTexture(16, 16, [
    { x: 3, y: 13, w: 10, h: 2, color: "#00000024" },
    { x: 4, y: 7, w: 8, h: 6, color: "#99623b" },
    { x: 5, y: 8, w: 6, h: 4, color: "#b37a4b" },
    { x: 6, y: 9, w: 1, h: 3, color: "#7b4f2f" },
    { x: 9, y: 9, w: 1, h: 3, color: "#7b4f2f" },
    { x: 5, y: 6, w: 2, h: 2, color: accent },
    { x: 8, y: 5, w: 2, h: 3, color: accentHighlight },
    { x: 10, y: 6, w: 1, h: 2, color: accent },
  ]);
}

function createTrellisTexture(variant: number): Texture {
  const vineA = variant === 0 ? "#75ad4d" : "#6ca245";
  const vineB = variant === 0 ? "#90c55d" : "#86bc56";
  const bloom = variant === 0 ? "#f0c96d" : "#da7c8f";

  return makeTexture(16, 24, [
    { x: 2, y: 20, w: 12, h: 2, color: "#00000020" },
    { x: 4, y: 6, w: 2, h: 14, color: "#8a5a35" },
    { x: 10, y: 6, w: 2, h: 14, color: "#8a5a35" },
    { x: 4, y: 8, w: 8, h: 2, color: "#b18051" },
    { x: 4, y: 13, w: 8, h: 2, color: "#b18051" },
    { x: 4, y: 18, w: 8, h: 2, color: "#b18051" },
    { x: 5, y: 4, w: 6, h: 3, color: vineA },
    { x: 6, y: 7, w: 2, h: 10, color: vineA },
    { x: 8, y: 6, w: 2, h: 12, color: vineB },
    { x: 5, y: 11, w: 6, h: 2, color: vineB },
    { x: 6, y: 5, w: 2, h: 2, color: bloom },
    { x: 9, y: 10, w: 2, h: 2, color: bloom },
    { x: 5, y: 15, w: 2, h: 2, color: bloom },
  ]);
}

function createClotheslineTexture(variant: number): Texture {
  const clothA = variant === 0 ? "#f3e1c9" : "#9dcae8";
  const clothB = variant === 0 ? "#d17972" : "#f0c96d";
  const clothC = variant === 0 ? "#9bc87d" : "#f3e1c9";

  return makeTexture(32, 22, [
    { x: 3, y: 19, w: 26, h: 2, color: "#00000020" },
    { x: 4, y: 7, w: 2, h: 12, color: "#80522f" },
    { x: 26, y: 7, w: 2, h: 12, color: "#80522f" },
    { x: 6, y: 7, w: 20, h: 1, color: "#e5d7bd" },
    { x: 9, y: 8, w: 4, h: 7, color: clothA },
    { x: 15, y: 8, w: 4, h: 6, color: clothB },
    { x: 21, y: 8, w: 3, h: 8, color: clothC },
    { x: 10, y: 15, w: 2, h: 1, color: "#d9c6a5" },
    { x: 16, y: 14, w: 2, h: 1, color: "#cda65d" },
    { x: 21, y: 16, w: 2, h: 1, color: "#d9c6a5" },
  ]);
}

function createGrassClumpTexture(variant: number): Texture {
  const bladeA = variant === 0 ? "#79ae46" : "#84b94d";
  const bladeB = variant === 0 ? "#93c85b" : "#9fd164";
  const bloom = variant === 0 ? "#f1d788" : "#f1b6c8";

  return makeTexture(16, 12, [
    { x: 2, y: 10, w: 12, h: 2, color: "#00000018" },
    { x: 3, y: 5, w: 2, h: 5, color: bladeA },
    { x: 6, y: 3, w: 2, h: 7, color: bladeB },
    { x: 9, y: 4, w: 2, h: 6, color: bladeA },
    { x: 12, y: 6, w: 1, h: 4, color: bladeB },
    { x: 7, y: 2, w: 1, h: 1, color: bloom },
    { x: 10, y: 3, w: 1, h: 1, color: bloom },
  ]);
}

function createStoneClusterTexture(variant: number): Texture {
  const stoneA = variant === 0 ? "#b7aa93" : "#c0b49f";
  const stoneB = variant === 0 ? "#8f826f" : "#998c78";

  return makeTexture(16, 12, [
    { x: 2, y: 10, w: 12, h: 2, color: "#00000018" },
    { x: 3, y: 6, w: 4, h: 4, color: stoneB },
    { x: 4, y: 5, w: 2, h: 3, color: stoneA },
    { x: 7, y: 7, w: 4, h: 3, color: stoneA },
    { x: 10, y: 5, w: 3, h: 5, color: stoneB },
    { x: 11, y: 6, w: 1, h: 2, color: stoneA },
  ]);
}

function createNoticeBoardTexture(): Texture {
  return makeTexture(24, 24, [
    { x: 2, y: 21, w: 20, h: 2, color: "#00000022" },
    { x: 5, y: 7, w: 2, h: 14, color: "#7f5232" },
    { x: 17, y: 7, w: 2, h: 14, color: "#7f5232" },
    { x: 4, y: 4, w: 16, h: 11, color: "#9a653f" },
    { x: 5, y: 5, w: 14, h: 9, color: "#c89f6a" },
    { x: 6, y: 6, w: 5, h: 3, color: "#f3e3c9" },
    { x: 12, y: 6, w: 5, h: 4, color: "#d9877c" },
    { x: 7, y: 10, w: 8, h: 2, color: "#8b5b37" },
    { x: 9, y: 15, w: 6, h: 2, color: "#7f5232" },
  ]);
}

function createWheelbarrowTexture(variant: number): Texture {
  const load = variant === 0 ? "#d7b86b" : "#88ba58";
  const loadAccent = variant === 0 ? "#c97e54" : "#e5d48b";

  return makeTexture(24, 16, [
    { x: 2, y: 13, w: 20, h: 2, color: "#00000020" },
    { x: 6, y: 7, w: 10, h: 5, color: "#a06d42" },
    { x: 8, y: 8, w: 8, h: 3, color: "#c28c57" },
    { x: 5, y: 9, w: 2, h: 4, color: "#7a5232" },
    { x: 16, y: 9, w: 5, h: 1, color: "#7a5232" },
    { x: 19, y: 10, w: 1, h: 3, color: "#7a5232" },
    { x: 3, y: 10, w: 3, h: 3, color: "#6d6d72" },
    { x: 4, y: 11, w: 1, h: 1, color: "#cfd0d6" },
    { x: 9, y: 5, w: 3, h: 2, color: load },
    { x: 12, y: 4, w: 3, h: 3, color: loadAccent },
  ]);
}

function createScarecrowTexture(variant: number): Texture {
  const shirt = variant === 0 ? "#cf7d6f" : "#7c9dc9";
  const patch = variant === 0 ? "#f0d8a2" : "#d8c18f";

  return makeTexture(16, 24, [
    { x: 2, y: 21, w: 12, h: 2, color: "#0000001f" },
    { x: 7, y: 7, w: 2, h: 14, color: "#855733" },
    { x: 3, y: 10, w: 10, h: 2, color: "#8c5d37" },
    { x: 5, y: 2, w: 6, h: 3, color: "#9a6a42" },
    { x: 6, y: 5, w: 4, h: 4, color: "#e5d6aa" },
    { x: 5, y: 10, w: 6, h: 6, color: shirt },
    { x: 6, y: 12, w: 2, h: 2, color: patch },
    { x: 6, y: 16, w: 1, h: 4, color: "#5d8f3f" },
    { x: 9, y: 16, w: 1, h: 4, color: "#5d8f3f" },
  ]);
}

function createStumpClusterTexture(): Texture {
  return makeTexture(24, 16, [
    { x: 2, y: 13, w: 20, h: 2, color: "#00000020" },
    { x: 4, y: 7, w: 6, h: 5, color: "#8a5a35" },
    { x: 5, y: 8, w: 4, h: 3, color: "#c69b63" },
    { x: 11, y: 6, w: 5, h: 6, color: "#7c4f2f" },
    { x: 12, y: 7, w: 3, h: 4, color: "#b98a56" },
    { x: 17, y: 8, w: 4, h: 4, color: "#8a5a35" },
    { x: 18, y: 9, w: 2, h: 2, color: "#c69b63" },
    { x: 14, y: 5, w: 2, h: 2, color: "#d07a76" },
    { x: 19, y: 7, w: 2, h: 2, color: "#d07a76" },
  ]);
}

function createFarmhouseBaseTexture(style: "brown" | "cream"): Texture {
  const wall = style === "brown" ? "#e9d3ac" : "#f3ead6";
  const trim = style === "brown" ? "#bc8a57" : "#cfbea4";
  const shadow = style === "brown" ? "#7f6144" : "#8e8069";
  const porch = style === "brown" ? "#b78a5c" : "#c7a780";
  const door = "#8a5737";
  const doorShade = "#6c4329";
  const window = "#94cfea";
  const windowShine = "#d9f2fb";
  const planter = "#a4653d";
  const leafA = "#7db24c";
  const leafB = "#98cb61";

  return makeTexture(48, 32, [
    { x: 4, y: 29, w: 40, h: 2, color: "#00000024" },
    { x: 2, y: 8, w: 44, h: 18, color: wall },
    { x: 2, y: 8, w: 44, h: 2, color: trim },
    { x: 2, y: 24, w: 44, h: 2, color: trim },
    { x: 2, y: 10, w: 2, h: 14, color: trim },
    { x: 44, y: 10, w: 2, h: 14, color: trim },
    { x: 6, y: 28, w: 36, h: 2, color: shadow },
    { x: 16, y: 26, w: 16, h: 2, color: porch },
    { x: 17, y: 27, w: 14, h: 1, color: "#8b6543" },
    { x: 20, y: 14, w: 8, h: 12, color: door },
    { x: 21, y: 15, w: 6, h: 11, color: doorShade },
    { x: 25, y: 20, w: 1, h: 1, color: "#e8cc8f" },
    { x: 6, y: 12, w: 8, h: 7, color: window },
    { x: 34, y: 12, w: 8, h: 7, color: window },
    { x: 7, y: 13, w: 6, h: 5, color: windowShine },
    { x: 35, y: 13, w: 6, h: 5, color: windowShine },
    { x: 5, y: 20, w: 10, h: 2, color: planter },
    { x: 33, y: 20, w: 10, h: 2, color: planter },
    { x: 7, y: 17, w: 2, h: 4, color: leafA },
    { x: 10, y: 16, w: 2, h: 5, color: leafB },
    { x: 36, y: 17, w: 2, h: 4, color: leafA },
    { x: 39, y: 16, w: 2, h: 5, color: leafB },
  ]);
}

function createFarmhouseRoofTexture(style: "brown" | "cream"): Texture {
  const roof = style === "brown" ? "#d0a16d" : "#c99a6a";
  const roofShade = style === "brown" ? "#ae7d4f" : "#b18457";
  const roofDark = style === "brown" ? "#946543" : "#976a49";
  const gable = "#9acd58";
  const gableTrim = "#f1e0bd";
  const chimney = "#8a5d3a";

  return makeTexture(48, 30, [
    { x: 4, y: 25, w: 40, h: 2, color: "#00000020" },
    { x: 6, y: 9, w: 36, h: 4, color: roof },
    { x: 4, y: 13, w: 40, h: 4, color: roof },
    { x: 3, y: 17, w: 42, h: 4, color: roofShade },
    { x: 2, y: 21, w: 44, h: 4, color: roofDark },
    { x: 18, y: 6, w: 12, h: 3, color: gableTrim },
    { x: 20, y: 3, w: 8, h: 3, color: gable },
    { x: 22, y: 1, w: 4, h: 2, color: gableTrim },
    { x: 34, y: 5, w: 4, h: 8, color: chimney },
    { x: 35, y: 4, w: 2, h: 1, color: "#d4c3aa" },
    { x: 8, y: 10, w: 1, h: 14, color: "#e7c796" },
    { x: 16, y: 9, w: 1, h: 15, color: "#e7c796" },
    { x: 24, y: 9, w: 1, h: 15, color: "#e7c796" },
    { x: 32, y: 10, w: 1, h: 14, color: "#e7c796" },
    { x: 40, y: 11, w: 1, h: 12, color: "#e7c796" },
  ]);
}

function orientationMap<T>(
  createFrames: (orientation: Orientation) => T[],
): Record<Orientation, T[]> {
  return {
    up: createFrames("up"),
    down: createFrames("down"),
    left: createFrames("left"),
    right: createFrames("right"),
  };
}

export function createActorTextureSet(
  key: string,
  isNpc: boolean,
): ActorTextureSet {
  const seed = hashString(key);
  const palette = actorPalette(seed, isNpc);

  return {
    idle: orientationMap((orientation) => [
      createActorFrame(palette, orientation, 0, "idle"),
    ]),
    walk: orientationMap((orientation) => [
      createActorFrame(palette, orientation, 0, "walk"),
      createActorFrame(palette, orientation, 1, "walk"),
      createActorFrame(palette, orientation, 2, "walk"),
    ]),
    talk: orientationMap((orientation) => [
      createActorFrame(palette, orientation, 0, "talk"),
      createActorFrame(palette, orientation, 1, "talk"),
    ]),
  };
}

export function createBearTextureSet(key: string): ActorTextureSet {
  const seed = hashString(key);
  const walkFrames = orientationMap((orientation) => [
    createBearFrame(orientation, 0),
    createBearFrame(orientation, seed % 2),
    createBearFrame(orientation, 2),
  ]);

  return {
    idle: {
      up: [walkFrames.up[0]],
      down: [walkFrames.down[0]],
      left: [walkFrames.left[0]],
      right: [walkFrames.right[0]],
    },
    walk: walkFrames,
    talk: {
      up: [walkFrames.up[1]],
      down: [walkFrames.down[1]],
      left: [walkFrames.left[1]],
      right: [walkFrames.right[1]],
    },
  };
}

export function createTerrainTextureSet(): TerrainTextureSet {
  return {
    grass: [
      createGrassTileTexture(0),
      createGrassTileTexture(1),
      createGrassTileTexture(2),
      createGrassTileTexture(3),
    ],
    dirt: [
      createDirtTileTexture(0),
      createDirtTileTexture(1),
      createDirtTileTexture(2),
    ],
    cobble: [
      createCobbleTileTexture(0),
      createCobbleTileTexture(1),
      createCobbleTileTexture(2),
    ],
    track: [
      createTrackTileTexture(0),
      createTrackTileTexture(1),
      createTrackTileTexture(2),
    ],
    tilled: [
      createTilledTileTexture(0),
      createTilledTileTexture(1),
      createTilledTileTexture(2),
    ],
    water: [createWaterTileTexture(0), createWaterTileTexture(1)],
  };
}

export function createFarmhouseTextureSet(
  style: "brown" | "cream",
): FarmhouseTextureSet {
  return {
    base: createFarmhouseBaseTexture(style),
    roof: createFarmhouseRoofTexture(style),
  };
}

export function createSceneTextureSet(
  sceneType: string,
  variant = 0,
): EntityTextureSet {
  if (sceneType === "picnic_blanket") {
    return { frames: [createPicnicBlanketTexture()], anchorY: 0.8 };
  }
  if (sceneType === "market_stall") {
    return { frames: [createMarketStallTexture()], anchorY: 0.9 };
  }
  if (sceneType === "garden_patch") {
    return { frames: [createGardenPatchTexture(variant)], anchorY: 0.82 };
  }
  if (sceneType === "lantern_post") {
    return { frames: createLanternFrames(), anchorY: 0.9 };
  }
  if (sceneType === "mailbox") {
    return { frames: [createMailboxTexture()], anchorY: 0.82 };
  }
  if (sceneType === "flower_bed") {
    return { frames: [createFlowerBedTexture(variant)], anchorY: 0.84 };
  }
  if (sceneType === "pond_reeds") {
    return { frames: [createPondReedsTexture()], anchorY: 0.86 };
  }
  if (sceneType === "wood_stack") {
    return { frames: [createWoodStackTexture()], anchorY: 0.86 };
  }
  if (sceneType === "porch_crate") {
    return { frames: [createPorchCrateTexture(variant)], anchorY: 0.84 };
  }
  if (sceneType === "trellis") {
    return { frames: [createTrellisTexture(variant)], anchorY: 0.9 };
  }
  if (sceneType === "clothesline") {
    return { frames: [createClotheslineTexture(variant)], anchorY: 0.92 };
  }
  if (sceneType === "grass_clump") {
    return { frames: [createGrassClumpTexture(variant)], anchorY: 0.88 };
  }
  if (sceneType === "stone_cluster") {
    return { frames: [createStoneClusterTexture(variant)], anchorY: 0.88 };
  }
  if (sceneType === "notice_board") {
    return { frames: [createNoticeBoardTexture()], anchorY: 0.92 };
  }
  if (sceneType === "wheelbarrow") {
    return { frames: [createWheelbarrowTexture(variant)], anchorY: 0.86 };
  }
  if (sceneType === "scarecrow") {
    return { frames: [createScarecrowTexture(variant)], anchorY: 0.92 };
  }
  if (sceneType === "stump_cluster") {
    return { frames: [createStumpClusterTexture()], anchorY: 0.86 };
  }

  return {
    frames: [
      makeTexture(16, 16, [
        { x: 4, y: 11, w: 8, h: 2, color: "#00000020" },
        { x: 5, y: 5, w: 6, h: 6, color: "#c8b79f" },
      ]),
    ],
    anchorY: 0.8,
  };
}

export function createEntityTextureSet(
  entityType: string,
  itemId?: string,
): EntityTextureSet {
  if (entityType === "berry_bush") {
    return { frames: [createBerryBushTexture("#8f50d1")], anchorY: 0.82 };
  }
  if (entityType === "bench") {
    return { frames: [createBenchTexture()], anchorY: 0.78 };
  }
  if (entityType === "campfire") {
    return { frames: createCampfireFrames(), anchorY: 0.8 };
  }
  if (entityType === "bear") {
    return { frames: [createBearFrame("down", 0)], anchorY: 0.82 };
  }
  if (entityType === "water_source") {
    return {
      frames: [
        makeTexture(16, 16, [
          { x: 3, y: 12, w: 10, h: 2, color: "#00000025" },
          { x: 4, y: 5, w: 8, h: 6, color: "#8c6a4f" },
          { x: 5, y: 3, w: 6, h: 2, color: "#d5cfbe" },
          { x: 6, y: 6, w: 4, h: 3, color: "#68c0df" },
        ]),
      ],
      anchorY: 0.84,
    };
  }

  if (entityType === "ground_item") {
    if (itemId === "raw_food")
      return { frames: [createRawFoodTexture()], anchorY: 0.78 };
    if (itemId === "cooked_food")
      return { frames: [createCookedFoodTexture()], anchorY: 0.78 };
    if (itemId === "bear_meat")
      return { frames: [createBearMeatTexture()], anchorY: 0.78 };
  }

  return {
    frames: [
      makeTexture(16, 16, [
        { x: 4, y: 11, w: 8, h: 2, color: "#00000025" },
        { x: 5, y: 5, w: 6, h: 6, color: "#c8b79f" },
        { x: 7, y: 7, w: 2, h: 2, color: "#8b6e52" },
      ]),
    ],
    anchorY: 0.8,
  };
}
