import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";
import {
  type ActorAnimationState,
  type ActorTextureSet,
  type EntityTextureSet,
  type TerrainTextureSet,
  createActorTextureSet,
  createBearTextureSet,
  createEntityTextureSet,
  createFarmhouseTextureSet,
  createSceneTextureSet,
  createTerrainTextureSet,
} from "./pixelSprites.js";
import type {
  NpcNeedsData,
  Orientation,
  Player,
  TileType,
  WorldEntity,
} from "./types.js";

const TILE_SOURCE_SIZE = 16;
const TILE_GAP = 1;
const TILE_SCALE = 4;
const TILE_SIZE = TILE_SOURCE_SIZE * TILE_SCALE;
const ACTOR_SCALE = 5;
const ENTITY_SCALE = TILE_SCALE;
const LOOK_AHEAD_PX = TILE_SIZE * 1.25;

const ATLAS_PATH =
  "/assets/kenney/roguelike-rpg-pack/Spritesheet/roguelikeSheet_transparent.png";

const SKY_COLOR = 0x85c7e5;
const NAME_STYLE = new TextStyle({
  fontFamily: "monospace",
  fontSize: 12,
  fontWeight: "700",
  fill: 0xfbf3de,
  stroke: { color: 0x4d3826, width: 2 },
  letterSpacing: 0.4,
});
const BUBBLE_TEXT_STYLE = new TextStyle({
  fontFamily: "monospace",
  fontSize: 13,
  fontWeight: "700",
  fill: 0x3b2b20,
  wordWrap: true,
  wordWrapWidth: 180,
});

type TileCoord = { col: number; row: number };
type PathSurfaceType = "dirt" | "cobble" | "track" | "tilled";

interface PlayerSprite {
  container: Container;
  shadow: Graphics;
  sprite: Sprite;
  namePlate: Graphics;
  nameLabel: Text;
  waitingIndicator: Container | null;
  chatBubble: Container | null;
  chatTimeout: ReturnType<typeof setTimeout> | null;
  needBars: Container | null;
  textures: ActorTextureSet;
}

interface EntitySprite {
  entity: WorldEntity;
  container: Container;
  shadow: Graphics;
  sprite: Sprite;
  textures: EntityTextureSet;
}

interface AnimatedSprite {
  sprite: Sprite;
  frames: Texture[];
  phaseMs: number;
  frameDurationMs: number;
}

interface SwaySprite {
  sprite: Sprite;
  baseX: number;
  phase: number;
  amplitude: number;
  rate: number;
}

const TILESET = {
  grass: [
    { row: 25, col: 9 },
    { row: 25, col: 10 },
    { row: 25, col: 11 },
    { row: 26, col: 9 },
    { row: 27, col: 9 },
  ],
  dirt: [
    { row: 25, col: 12 },
    { row: 25, col: 13 },
    { row: 25, col: 14 },
    { row: 26, col: 12 },
  ],
  weeds: [
    { row: 9, col: 28 },
    { row: 9, col: 30 },
    { row: 9, col: 31 },
    { row: 10, col: 26 },
    { row: 11, col: 26 },
  ],
  flowers: [
    { row: 9, col: 28 },
    { row: 9, col: 29 },
    { row: 9, col: 30 },
    { row: 9, col: 31 },
  ],
  tallTrees: [
    { row: 11, col: 16 },
    { row: 11, col: 17 },
    { row: 11, col: 18 },
  ],
  roundTrees: [
    { row: 9, col: 19 },
    { row: 9, col: 20 },
    { row: 9, col: 21 },
  ],
  orchardTrees: [
    { row: 9, col: 23 },
    { row: 9, col: 24 },
  ],
  bushes: [
    { row: 10, col: 24 },
    { row: 11, col: 24 },
    { row: 11, col: 26 },
  ],
  fenceHorizontal: { row: 23, col: 48 },
};

function hashCoord(x: number, y: number, salt = 0): number {
  let hash = (x + 17) * 374761393 + (y + 29) * 668265263 + salt * 2147483647;
  hash = (hash ^ (hash >> 13)) * 1274126177;
  return (hash ^ (hash >> 16)) >>> 0;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function orientationVector(orientation: Orientation): { x: number; y: number } {
  if (orientation === "left") return { x: -1, y: 0 };
  if (orientation === "right") return { x: 1, y: 0 };
  if (orientation === "up") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

export class GameRenderer {
  private app = new Application();
  private atlas: Texture | null = null;
  private terrainTextures: TerrainTextureSet | null = null;

  private cameraContainer = new Container();
  private worldContainer = new Container();
  private groundContainer = new Container();
  private detailContainer = new Container();
  private propContainer = new Container();
  private worldObjectContainer = new Container();
  private canopyContainer = new Container();
  private overlayContainer = new Container();
  private ambientOverlay = new Graphics();

  private mapTiles: TileType[][] | null = null;
  private mapWidth = 0;
  private mapHeight = 0;
  private worldPixelWidth = 0;
  private worldPixelHeight = 0;
  private selfId: string | null = null;
  private cameraX = 0;
  private cameraY = 0;

  private playerSprites = new Map<string, PlayerSprite>();
  private entitySprites = new Map<string, EntitySprite>();
  private entities = new Map<string, WorldEntity>();
  private npcNeeds = new Map<string, NpcNeedsData>();
  private animatedSprites: AnimatedSprite[] = [];
  private swayingSprites: SwaySprite[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.worldObjectContainer.sortableChildren = true;
    this.canopyContainer.sortableChildren = true;
  }

  async init(): Promise<void> {
    const resizeTarget = this.canvas.parentElement ?? undefined;

    await this.app.init({
      canvas: this.canvas,
      resizeTo: resizeTarget,
      backgroundColor: SKY_COLOR,
      antialias: false,
    });

    this.atlas = await Assets.load({
      src: ATLAS_PATH,
      data: {
        scaleMode: "nearest",
      },
    });
    this.terrainTextures = createTerrainTextureSet();

    this.cameraContainer.addChild(this.worldContainer);
    this.worldContainer.addChild(this.groundContainer);
    this.worldContainer.addChild(this.detailContainer);
    this.worldContainer.addChild(this.propContainer);
    this.worldContainer.addChild(this.worldObjectContainer);
    this.worldContainer.addChild(this.canopyContainer);
    this.worldContainer.addChild(this.overlayContainer);
    this.app.stage.addChild(this.cameraContainer);
    this.app.ticker.add(() => {
      this.animateScene(performance.now());
    });
  }

  setSelfId(id: string | null): void {
    this.selfId = id;
  }

  renderMap(tiles: TileType[][]): void {
    if (!this.atlas) {
      throw new Error("Renderer atlas has not loaded");
    }

    this.mapTiles = tiles;
    this.mapWidth = tiles[0]?.length ?? 0;
    this.mapHeight = tiles.length;
    this.worldPixelWidth = this.mapWidth * TILE_SIZE;
    this.worldPixelHeight = this.mapHeight * TILE_SIZE;

    this.groundContainer.removeChildren();
    this.detailContainer.removeChildren();
    this.propContainer.removeChildren();
    this.worldObjectContainer.removeChildren();
    this.canopyContainer.removeChildren();
    this.overlayContainer.removeChildren();
    this.animatedSprites = [];
    this.swayingSprites = [];

    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        this.renderGroundTile(x, y, tiles[y][x]);
      }
    }

    this.renderSceneScenery();
    this.overlayContainer.addChild(this.ambientOverlay);
    this.animateScene(performance.now());
    this.centerCameraOnWorld();
  }

  updatePlayers(players: Player[]): void {
    const now = performance.now();
    const currentIds = new Set(players.map((player) => player.id));

    for (const [id, sprite] of this.playerSprites) {
      if (!currentIds.has(id)) {
        this.worldObjectContainer.removeChild(sprite.container);
        this.playerSprites.delete(id);
      }
    }

    for (const player of players) {
      let sprite = this.playerSprites.get(player.id);
      if (!sprite) {
        sprite = this.createPlayerSprite(player);
        this.playerSprites.set(player.id, sprite);
        this.worldObjectContainer.addChild(sprite.container);
      }

      const targetX = player.x * TILE_SIZE + TILE_SIZE / 2;
      const targetY = player.y * TILE_SIZE + TILE_SIZE / 2 + TILE_SIZE * 0.18;

      if (player.id === this.selfId) {
        sprite.container.x = targetX;
        sprite.container.y = targetY;
      } else {
        sprite.container.x += (targetX - sprite.container.x) * 0.24;
        sprite.container.y += (targetY - sprite.container.y) * 0.24;
      }

      sprite.container.zIndex = Math.round(sprite.container.y);
      sprite.nameLabel.text =
        player.id === this.selfId ? `${player.name} • you` : player.name;
      this.syncNamePlate(sprite, player.id === this.selfId);

      const renderOrientation = this.conversationFacingOrientation(
        player,
        players,
      );
      const renderState = this.animationStateForPlayer(player);
      const frames = sprite.textures[renderState][renderOrientation];
      const frameIndex =
        renderState === "idle"
          ? 0
          : Math.floor(now / (renderState === "talk" ? 220 : 170)) %
            frames.length;
      sprite.sprite.texture = frames[frameIndex];
      sprite.shadow.clear();
      sprite.shadow.ellipse(0, 5, TILE_SIZE * 0.22, TILE_SIZE * 0.12);
      sprite.shadow.fill({
        color: 0x000000,
        alpha: player.id === this.selfId ? 0.24 : 0.18,
      });
      if (player.id === this.selfId) {
        sprite.shadow.ellipse(0, 4, TILE_SIZE * 0.27, TILE_SIZE * 0.15);
        sprite.shadow.stroke({ color: 0xf5d58f, width: 2, alpha: 0.55 });
      }

      this.updateWaitingIndicator(sprite, player.isWaitingForResponse === true);
      this.renderNeedBars(player.id);
    }
    const self = players.find((player) => player.id === this.selfId);
    if (self) {
      this.applyCamera(self);
    } else {
      this.centerCameraOnWorld();
    }
  }

  showChatBubble(playerId: string, content: string): void {
    const sprite = this.playerSprites.get(playerId);
    if (!sprite) return;

    if (sprite.chatBubble) {
      sprite.container.removeChild(sprite.chatBubble);
      sprite.chatBubble = null;
    }
    if (sprite.chatTimeout) {
      clearTimeout(sprite.chatTimeout);
    }

    const bubble = new Container();
    const text = new Text({
      text: content.length > 42 ? `${content.slice(0, 39)}...` : content,
      style: BUBBLE_TEXT_STYLE,
    });
    text.anchor.set(0.5, 1);

    const background = new Graphics();
    const paddingX = 8;
    const paddingY = 6;
    background.roundRect(
      -text.width / 2 - paddingX,
      -text.height - paddingY,
      text.width + paddingX * 2,
      text.height + paddingY * 2,
      6,
    );
    background.fill(0xf7ebc6);
    background.stroke({ color: 0x8d6a47, width: 2 });

    const tail = new Graphics();
    tail.poly([
      { x: -5, y: 0 },
      { x: 5, y: 0 },
      { x: 0, y: 8 },
    ]);
    tail.fill(0xf7ebc6);
    tail.stroke({ color: 0x8d6a47, width: 2 });

    bubble.addChild(background);
    bubble.addChild(tail);
    bubble.addChild(text);
    bubble.y = -TILE_SIZE * 0.7;

    sprite.container.addChild(bubble);
    sprite.chatBubble = bubble;
    sprite.chatTimeout = setTimeout(() => {
      if (sprite.chatBubble) {
        sprite.container.removeChild(sprite.chatBubble);
        sprite.chatBubble = null;
      }
    }, 5000);
  }

  updateEntities(entities: WorldEntity[]): void {
    const currentIds = new Set(entities.map((entity) => entity.id));

    for (const [id, sprite] of this.entitySprites) {
      if (!currentIds.has(id)) {
        this.worldObjectContainer.removeChild(sprite.container);
        this.entitySprites.delete(id);
        this.entities.delete(id);
      }
    }

    for (const entity of entities) {
      this.entities.set(entity.id, entity);
      this.syncEntitySprite(entity);
    }
  }

  updateEntity(entity: WorldEntity): void {
    this.entities.set(entity.id, entity);
    this.syncEntitySprite(entity);
  }

  removeEntity(entityId: string): void {
    const sprite = this.entitySprites.get(entityId);
    if (sprite) {
      this.worldObjectContainer.removeChild(sprite.container);
      this.entitySprites.delete(entityId);
    }
    this.entities.delete(entityId);
  }

  updateNpcNeeds(data: NpcNeedsData): void {
    this.npcNeeds.set(data.npcId, data);
    this.renderNeedBars(data.npcId);
  }

  private renderGroundTile(x: number, y: number, tileType: TileType): void {
    const groundTexture = this.pickGroundTexture(x, y);
    this.addTileSprite(this.groundContainer, groundTexture, x, y);

    if (this.isPathTile(x, y)) {
      const surface = this.pathSurfaceType(x, y);
      const pathTexture = this.pickPathTexture(surface, x, y);
      const alpha =
        surface === "track" ? 0.84 : surface === "tilled" ? 0.94 : 0.98;
      this.addTileSprite(this.detailContainer, pathTexture, x, y, alpha);
      this.addPathEdgeDetail(x, y, surface);
    }

    if (tileType === "water") {
      const waterFrames = this.requireTerrainTextures().water;
      const waterTexture = this.pickTerrainTexture(
        waterFrames,
        hashCoord(x, y, 181),
      );
      const waterSprite = this.addTileSprite(
        this.detailContainer,
        waterTexture,
        x,
        y,
      );
      this.registerAnimatedSprite(
        waterSprite,
        waterFrames,
        hashCoord(x, y, 187),
        820,
      );
      this.addWaterEdgeOverlay(x, y);
      return;
    }

    if (tileType === "floor" && this.isPondBankTile(x, y)) {
      this.addPondBankOverlay(x, y);
    }

    if (tileType === "wall") {
      this.renderWallDecoration(x, y);
      return;
    }

    const noise = hashCoord(x, y, 7);
    if (!this.isPathTile(x, y) && noise % 7 === 0) {
      const detailTexture = this.pickTile(TILESET.weeds, noise);
      this.addTileSprite(this.detailContainer, detailTexture, x, y, 0.6);
    } else if (!this.isPathTile(x, y) && noise % 19 === 0) {
      const flowerTexture = this.pickTile(TILESET.flowers, noise);
      this.addTileSprite(this.detailContainer, flowerTexture, x, y, 0.7);
    }
  }

  private addPathEdgeDetail(
    x: number,
    y: number,
    surface: PathSurfaceType,
  ): void {
    const north = this.isPathTile(x, y - 1);
    const south = this.isPathTile(x, y + 1);
    const east = this.isPathTile(x + 1, y);
    const west = this.isPathTile(x - 1, y);
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    const edgeShade =
      surface === "cobble"
        ? 0x6c665f
        : surface === "tilled"
          ? 0x5d371e
          : 0x5c4126;
    const edgeLight =
      surface === "cobble"
        ? 0xe3d8c6
        : surface === "tilled"
          ? 0xc9935d
          : 0xf2d39a;
    const sideShade =
      surface === "cobble"
        ? 0x797167
        : surface === "tilled"
          ? 0x6a4124
          : 0x6b4a28;

    const shade = new Graphics();
    if (!north) {
      shade.rect(px + 6, py + 2, TILE_SIZE - 12, 3);
      shade.fill({
        color: edgeShade,
        alpha: surface === "track" ? 0.12 : 0.18,
      });
    }
    if (!south) {
      shade.rect(px + 6, py + TILE_SIZE - 5, TILE_SIZE - 12, 3);
      shade.fill({
        color: edgeLight,
        alpha: surface === "track" ? 0.12 : 0.16,
      });
    }
    if (!west) {
      shade.rect(px + 2, py + 7, 3, TILE_SIZE - 14);
      shade.fill({ color: sideShade, alpha: surface === "track" ? 0.1 : 0.14 });
    }
    if (!east) {
      shade.rect(px + TILE_SIZE - 5, py + 7, 3, TILE_SIZE - 14);
      shade.fill({
        color: edgeLight,
        alpha: surface === "track" ? 0.09 : 0.12,
      });
    }

    const seed = hashCoord(x, y, 912);
    const pebbleX = px + 8 + (seed % 36);
    const pebbleY = py + 8 + ((seed >> 4) % 30);
    shade.rect(pebbleX, pebbleY, 4, 3);
    shade.fill({
      color:
        surface === "cobble"
          ? 0xf1e7d7
          : surface === "tilled"
            ? 0xd6a46a
            : 0xe9d3ab,
      alpha: 0.55,
    });
    shade.rect(
      px + 12 + ((seed >> 7) % 26),
      py + 14 + ((seed >> 10) % 22),
      3,
      2,
    );
    shade.fill({
      color:
        surface === "cobble"
          ? 0x797063
          : surface === "tilled"
            ? 0x724325
            : 0x8a5b33,
      alpha: 0.34,
    });

    this.detailContainer.addChild(shade);

    if (surface === "tilled") {
      const furrow = new Graphics();
      furrow.rect(px + 11, py + 1, 2, TILE_SIZE - 2);
      furrow.fill({ color: 0x6a3e21, alpha: 0.32 });
      furrow.rect(px + 29, py + 1, 2, TILE_SIZE - 2);
      furrow.fill({ color: 0x6a3e21, alpha: 0.28 });
      this.detailContainer.addChild(furrow);
    }

    if (!north && seed % 3 === 0 && surface !== "cobble") {
      const tuft = new Graphics();
      tuft.rect(px + 5 + (seed % 18), py + 1, 2, 5);
      tuft.fill({ color: 0x87b84b, alpha: 0.72 });
      tuft.rect(px + 8 + ((seed >> 4) % 18), py + 2, 2, 4);
      tuft.fill({ color: 0x93c455, alpha: 0.7 });
      this.propContainer.addChild(tuft);
      if (surface === "track" || surface === "dirt") {
        this.addSceneProp(
          "grass_clump",
          x + 0.14 + ((seed >> 4) % 6) * 0.05,
          y + 0.03,
          seed % 2,
        );
      }
    }
    if (!south && seed % 5 === 0 && surface !== "cobble") {
      const tuft = new Graphics();
      tuft.rect(px + 9 + (seed % 15), py + TILE_SIZE - 6, 2, 5);
      tuft.fill({ color: 0x7ea947, alpha: 0.7 });
      tuft.rect(px + 14 + ((seed >> 3) % 15), py + TILE_SIZE - 5, 2, 4);
      tuft.fill({ color: 0x9acb57, alpha: 0.68 });
      this.propContainer.addChild(tuft);
      if (surface === "track" || surface === "dirt") {
        this.addSceneProp(
          "grass_clump",
          x + 0.34 + ((seed >> 5) % 5) * 0.05,
          y + 0.87,
          (seed >> 1) % 2,
        );
      }
    }
    if (!east && seed % 4 === 0 && surface !== "track") {
      this.addSceneProp(
        "stone_cluster",
        x + 0.9,
        y + 0.46 + ((seed >> 7) % 5) * 0.03,
        seed % 2,
      );
    }
    if (!west && seed % 6 === 0 && surface !== "track") {
      this.addSceneProp(
        "stone_cluster",
        x + 0.08,
        y + 0.44 + ((seed >> 8) % 5) * 0.03,
        (seed >> 2) % 2,
      );
    }
  }

  private addPondBankOverlay(x: number, y: number): void {
    const north = this.tileAt(x, y - 1) === "water";
    const south = this.tileAt(x, y + 1) === "water";
    const east = this.tileAt(x + 1, y) === "water";
    const west = this.tileAt(x - 1, y) === "water";
    const northEast = this.tileAt(x + 1, y - 1) === "water";
    const northWest = this.tileAt(x - 1, y - 1) === "water";
    const southEast = this.tileAt(x + 1, y + 1) === "water";
    const southWest = this.tileAt(x - 1, y + 1) === "water";
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    const bank = new Graphics();

    if (north) {
      bank.roundRect(px + 8, py - 2, TILE_SIZE - 16, 12, 8);
      bank.fill({ color: 0xf1e2b6, alpha: 0.42 });
      bank.rect(px + 10, py + 3, TILE_SIZE - 20, 3);
      bank.fill({ color: 0xb8dde7, alpha: 0.36 });
    }
    if (south) {
      bank.roundRect(px + 8, py + TILE_SIZE - 10, TILE_SIZE - 16, 12, 8);
      bank.fill({ color: 0xf1e2b6, alpha: 0.42 });
      bank.rect(px + 10, py + TILE_SIZE - 6, TILE_SIZE - 20, 3);
      bank.fill({ color: 0xb8dde7, alpha: 0.34 });
    }
    if (west) {
      bank.roundRect(px - 2, py + 8, 12, TILE_SIZE - 16, 8);
      bank.fill({ color: 0xf1e2b6, alpha: 0.4 });
      bank.rect(px + 3, py + 10, 3, TILE_SIZE - 20);
      bank.fill({ color: 0xb8dde7, alpha: 0.32 });
    }
    if (east) {
      bank.roundRect(px + TILE_SIZE - 10, py + 8, 12, TILE_SIZE - 16, 8);
      bank.fill({ color: 0xf1e2b6, alpha: 0.4 });
      bank.rect(px + TILE_SIZE - 6, py + 10, 3, TILE_SIZE - 20);
      bank.fill({ color: 0xb8dde7, alpha: 0.32 });
    }

    if (northWest && !north && !west) {
      bank.circle(px + 8, py + 8, 7);
      bank.fill({ color: 0xf1e2b6, alpha: 0.34 });
    }
    if (northEast && !north && !east) {
      bank.circle(px + TILE_SIZE - 8, py + 8, 7);
      bank.fill({ color: 0xf1e2b6, alpha: 0.34 });
    }
    if (southWest && !south && !west) {
      bank.circle(px + 8, py + TILE_SIZE - 8, 7);
      bank.fill({ color: 0xf1e2b6, alpha: 0.34 });
    }
    if (southEast && !south && !east) {
      bank.circle(px + TILE_SIZE - 8, py + TILE_SIZE - 8, 7);
      bank.fill({ color: 0xf1e2b6, alpha: 0.34 });
    }

    this.detailContainer.addChild(bank);

    const seed = hashCoord(x, y, 1201);
    if (!this.isPathTile(x, y) && seed % 3 === 0) {
      this.addSceneProp(
        "grass_clump",
        x + 0.24 + ((seed >> 4) % 4) * 0.07,
        y + 0.68,
        seed % 2,
      );
    } else if (!this.isPathTile(x, y) && seed % 5 === 0) {
      this.addSceneProp(
        "stone_cluster",
        x + 0.22 + ((seed >> 3) % 5) * 0.06,
        y + 0.72,
        seed % 2,
      );
    }
  }

  private renderWallDecoration(x: number, y: number): void {
    const wallNorth = this.tileAt(x, y - 1) === "wall";
    const wallSouth = this.tileAt(x, y + 1) === "wall";
    const wallEast = this.tileAt(x + 1, y) === "wall";
    const wallWest = this.tileAt(x - 1, y) === "wall";
    const isBoundary =
      x === 0 || y === 0 || x === this.mapWidth - 1 || y === this.mapHeight - 1;
    const seed = hashCoord(x, y, 301);

    if (isBoundary && seed % 3 !== 0) {
      const treeTile =
        seed % 5 === 0
          ? this.pickCoord(TILESET.roundTrees, seed)
          : this.pickCoord(TILESET.tallTrees, seed);
      this.addSplitTree(x, y, treeTile);
      return;
    }

    if (wallEast || wallWest) {
      this.addFence(x, y, "horizontal");
      return;
    }

    if (wallNorth || wallSouth) {
      this.addFence(x, y, "vertical");
      return;
    }

    const bushTexture = this.pickTile(TILESET.bushes, seed);
    this.addPropSprite(this.worldObjectContainer, bushTexture, x, y, {
      anchorY: 0.84,
      zIndexBias: 8,
    });
  }

  private renderSceneScenery(): void {
    this.addFarmhouse(1.6, 1.4, "brown");
    this.addFarmhouse(13.4, 1.4, "brown");
    this.addFarmhouse(7.8, 13.7, "cream");

    for (let x = 2; x <= 4; x++) {
      this.addFence(x, 5, "horizontal");
    }
    for (let x = 15; x <= 17; x++) {
      this.addFence(x, 5, "horizontal");
    }

    const grove: Array<[number, number]> = [
      [1, 7],
      [2, 9],
      [1, 12],
      [3, 13],
      [16, 14],
      [17, 16],
      [15, 17],
    ];
    for (const [x, y] of grove) {
      const texture = this.pickCoord(
        TILESET.orchardTrees,
        hashCoord(x, y, 444),
      );
      this.addSplitTree(x, y, texture);
    }

    const bushes: Array<[number, number]> = [
      [2, 4],
      [17, 4],
      [6, 7],
      [7, 6],
      [12, 6],
      [13, 7],
      [4, 15],
      [5, 16],
      [12, 15],
      [14, 16],
    ];
    for (const [x, y] of bushes) {
      const texture = this.pickTile(TILESET.bushes, hashCoord(x, y, 773));
      this.addPropSprite(this.worldObjectContainer, texture, x, y, {
        anchorY: 0.86,
        zIndexBias: 10,
      });
    }

    const well = createEntityTextureSet("water_source");
    const wellContainer = this.createStaticEntitySprite(well, 4.3, 7.3);
    this.worldObjectContainer.addChild(wellContainer);

    this.addBenchNook(2.7, 8.0);
    this.addMarketStall(15.2, 6.8);
    this.addGardenPatch(4.2, 14.5, 0);
    this.addGardenPatch(12.6, 14.7, 1);
    this.addLanternPost(8.5, 11.2);
    this.addLanternPost(11.5, 11.2);
    this.addMailbox(3.9, 4.8);
    this.addMailbox(16.0, 4.8);
    this.addMailbox(10.7, 16.5);
    this.addFlowerBed(2.3, 4.6, 0);
    this.addFlowerBed(14.5, 4.6, 1);
    this.addFlowerBed(9.1, 16.1, 1);
    this.addPorchCrate(2.05, 4.9, 0);
    this.addWoodStack(4.95, 4.95);
    this.addClothesline(5.45, 2.95, 0);
    this.addTrellis(1.2, 3.4, 0);
    this.addPorchCrate(15.55, 4.95, 1);
    this.addWoodStack(17.2, 4.95);
    this.addClothesline(12.35, 3.05, 1);
    this.addTrellis(17.15, 3.45, 1);
    this.addPorchCrate(8.65, 17.0, 0);
    this.addWoodStack(11.35, 16.95);
    this.addClothesline(6.15, 15.35, 0);
    this.addTrellis(12.1, 15.55, 1);
    this.addNoticeBoard(12.35, 11.5);
    this.addWheelbarrow(16.75, 7.9, 0);
    this.addWheelbarrow(4.95, 14.2, 1);
    this.addScarecrow(8.55, 15.0, 0);
    this.addStumpCluster(2.1, 12.45);
    this.addStumpCluster(16.15, 16.55);
    this.addPondReeds(8.5, 7.25);
    this.addPondReeds(11.2, 7.2);
    this.addPondReeds(8.75, 8.65);
    this.addPondReeds(10.95, 8.65);
  }

  private addBenchNook(tileX: number, tileY: number): void {
    const blanket = createSceneTextureSet("picnic_blanket");
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(blanket, tileX, tileY + 0.25),
    );

    const bench = createEntityTextureSet("bench");
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(bench, tileX - 0.2, tileY + 0.2),
    );

    const campfire = createEntityTextureSet("campfire");
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(campfire, tileX + 0.75, tileY),
    );
  }

  private addMarketStall(tileX: number, tileY: number): void {
    const stall = createSceneTextureSet("market_stall");
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(stall, tileX + 0.55, tileY + 0.55),
    );
  }

  private addGardenPatch(tileX: number, tileY: number, variant: number): void {
    const garden = createSceneTextureSet("garden_patch", variant);
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(garden, tileX + 0.45, tileY + 0.4),
    );
  }

  private addLanternPost(tileX: number, tileY: number): void {
    const lantern = createSceneTextureSet("lantern_post");
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(lantern, tileX, tileY + 0.05),
    );
  }

  private addMailbox(tileX: number, tileY: number): void {
    const mailbox = createSceneTextureSet("mailbox");
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(mailbox, tileX, tileY),
    );
  }

  private addFlowerBed(tileX: number, tileY: number, variant: number): void {
    const flowerBed = createSceneTextureSet("flower_bed", variant);
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(flowerBed, tileX, tileY),
    );
  }

  private addPondReeds(tileX: number, tileY: number): void {
    const reeds = createSceneTextureSet("pond_reeds");
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(reeds, tileX, tileY),
    );
  }

  private addNoticeBoard(tileX: number, tileY: number): void {
    this.addSceneProp("notice_board", tileX, tileY);
  }

  private addWheelbarrow(tileX: number, tileY: number, variant: number): void {
    this.addSceneProp("wheelbarrow", tileX, tileY, variant);
  }

  private addScarecrow(tileX: number, tileY: number, variant: number): void {
    this.addSceneProp("scarecrow", tileX, tileY, variant);
  }

  private addStumpCluster(tileX: number, tileY: number): void {
    this.addSceneProp("stump_cluster", tileX, tileY);
  }

  private addWoodStack(tileX: number, tileY: number): void {
    const woodStack = createSceneTextureSet("wood_stack");
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(woodStack, tileX, tileY),
    );
  }

  private addPorchCrate(tileX: number, tileY: number, variant: number): void {
    const crate = createSceneTextureSet("porch_crate", variant);
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(crate, tileX, tileY),
    );
  }

  private addTrellis(tileX: number, tileY: number, variant: number): void {
    const trellis = createSceneTextureSet("trellis", variant);
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(trellis, tileX, tileY),
    );
  }

  private addClothesline(tileX: number, tileY: number, variant: number): void {
    const clothesline = createSceneTextureSet("clothesline", variant);
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(clothesline, tileX, tileY),
    );
  }

  private addSceneProp(
    sceneType: string,
    tileX: number,
    tileY: number,
    variant = 0,
  ): void {
    const prop = createSceneTextureSet(sceneType, variant);
    this.worldObjectContainer.addChild(
      this.createStaticEntitySprite(prop, tileX, tileY),
    );
  }

  private addFarmhouse(
    tileX: number,
    tileY: number,
    style: "brown" | "cream",
  ): void {
    const textures = createFarmhouseTextureSet(style);
    const centerX = (tileX + 1.5) * TILE_SIZE;

    const base = new Sprite(textures.base);
    base.anchor.set(0.5, 1);
    base.scale.set(TILE_SCALE);
    base.roundPixels = true;
    base.x = centerX;
    base.y = (tileY + 3.1) * TILE_SIZE;
    base.zIndex = Math.round(base.y);
    this.worldObjectContainer.addChild(base);

    const roof = new Sprite(textures.roof);
    roof.anchor.set(0.5, 1);
    roof.scale.set(TILE_SCALE);
    roof.roundPixels = true;
    roof.x = centerX;
    roof.y = (tileY + 2.08) * TILE_SIZE;
    roof.zIndex = Math.round(roof.y);
    this.canopyContainer.addChild(roof);
  }

  private addFence(
    x: number,
    y: number,
    orientation: "horizontal" | "vertical",
  ): void {
    const texture = this.atlasTexture(TILESET.fenceHorizontal);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.78);
    sprite.scale.set(TILE_SCALE);
    sprite.roundPixels = true;
    sprite.x = x * TILE_SIZE + TILE_SIZE / 2;
    sprite.y = y * TILE_SIZE + TILE_SIZE * 0.92;
    if (orientation === "vertical") {
      sprite.rotation = Math.PI / 2;
    }
    sprite.zIndex = Math.round(sprite.y);
    this.worldObjectContainer.addChild(sprite);
  }

  private addSplitTree(x: number, y: number, coord: TileCoord): void {
    if (!this.atlas) return;

    const treeBottom = this.atlasPixelTexture(
      coord.col,
      coord.row,
      0,
      10,
      16,
      6,
    );
    const treeTop = this.atlasPixelTexture(coord.col, coord.row, 0, 0, 16, 10);
    const baseX = x * TILE_SIZE + TILE_SIZE / 2;
    const baseY = y * TILE_SIZE + TILE_SIZE * 0.95;

    const trunk = new Sprite(treeBottom);
    trunk.anchor.set(0.5, 1);
    trunk.scale.set(TILE_SCALE);
    trunk.roundPixels = true;
    trunk.x = baseX;
    trunk.y = baseY;
    trunk.zIndex = Math.round(baseY);
    this.worldObjectContainer.addChild(trunk);

    const canopy = new Sprite(treeTop);
    canopy.anchor.set(0.5, 0);
    canopy.scale.set(TILE_SCALE);
    canopy.roundPixels = true;
    canopy.x = baseX;
    canopy.y = baseY - TILE_SIZE;
    canopy.zIndex = Math.round(canopy.y);
    this.canopyContainer.addChild(canopy);
    this.registerSwaySprite(canopy, baseX, hashCoord(x, y, 611), 1.6, 1200);
  }

  private addWaterEdgeOverlay(x: number, y: number): void {
    const north = this.tileAt(x, y - 1) === "water";
    const south = this.tileAt(x, y + 1) === "water";
    const east = this.tileAt(x + 1, y) === "water";
    const west = this.tileAt(x - 1, y) === "water";

    const edge = new Graphics();
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    const shore = 6;

    edge.rect(px, py, TILE_SIZE, TILE_SIZE);
    edge.stroke({ color: 0xf3edd2, width: 2, alpha: 0.1 });

    if (!north) {
      edge.rect(px, py, TILE_SIZE, shore);
      edge.fill({ color: 0xf3edd2, alpha: 0.75 });
      edge.rect(px, py + shore, TILE_SIZE, 3);
      edge.fill({ color: 0xa97d4d, alpha: 0.42 });
    }
    if (!south) {
      edge.rect(px, py + TILE_SIZE - shore, TILE_SIZE, shore);
      edge.fill({ color: 0xf3edd2, alpha: 0.75 });
      edge.rect(px, py + TILE_SIZE - shore - 3, TILE_SIZE, 3);
      edge.fill({ color: 0xa97d4d, alpha: 0.42 });
    }
    if (!west) {
      edge.rect(px, py, shore, TILE_SIZE);
      edge.fill({ color: 0xf3edd2, alpha: 0.68 });
    }
    if (!east) {
      edge.rect(px + TILE_SIZE - shore, py, shore, TILE_SIZE);
      edge.fill({ color: 0xf3edd2, alpha: 0.68 });
    }

    this.detailContainer.addChild(edge);
  }

  private addTileSprite(
    container: Container,
    texture: Texture,
    x: number,
    y: number,
    alpha = 1,
  ): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0);
    sprite.scale.set(TILE_SCALE);
    sprite.roundPixels = true;
    sprite.alpha = alpha;
    sprite.x = x * TILE_SIZE;
    sprite.y = y * TILE_SIZE;
    container.addChild(sprite);
    return sprite;
  }

  private addPropSprite(
    container: Container,
    texture: Texture,
    x: number,
    y: number,
    options: { anchorY: number; zIndexBias?: number },
  ): void {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, options.anchorY);
    sprite.scale.set(TILE_SCALE);
    sprite.roundPixels = true;
    sprite.x = x * TILE_SIZE + TILE_SIZE / 2;
    sprite.y = y * TILE_SIZE + TILE_SIZE * 0.92;
    sprite.zIndex = Math.round(sprite.y + (options.zIndexBias ?? 0));
    container.addChild(sprite);
  }

  private createPlayerSprite(player: Player): PlayerSprite {
    const container = new Container();
    const shadow = new Graphics();
    const sprite = new Sprite(Texture.EMPTY);
    const namePlate = new Graphics();
    sprite.anchor.set(0.5, 0.82);
    sprite.scale.set(ACTOR_SCALE);
    sprite.roundPixels = true;

    const nameLabel = new Text({
      text: player.name,
      style: NAME_STYLE,
    });
    nameLabel.anchor.set(0.5, 1);
    nameLabel.y = -TILE_SIZE * 0.78;

    const textures = player.description.toLowerCase().includes("bear")
      ? createBearTextureSet(player.id)
      : createActorTextureSet(player.id, player.isNpc);

    container.addChild(shadow);
    container.addChild(sprite);
    container.addChild(namePlate);
    container.addChild(nameLabel);
    container.x = player.x * TILE_SIZE + TILE_SIZE / 2;
    container.y = player.y * TILE_SIZE + TILE_SIZE / 2 + TILE_SIZE * 0.18;

    return {
      container,
      shadow,
      sprite,
      namePlate,
      nameLabel,
      waitingIndicator: null,
      chatBubble: null,
      chatTimeout: null,
      needBars: null,
      textures,
    };
  }

  private syncEntitySprite(entity: WorldEntity): void {
    if (entity.destroyed) {
      this.removeEntity(entity.id);
      return;
    }

    let sprite = this.entitySprites.get(entity.id);
    if (!sprite) {
      const textures = createEntityTextureSet(
        entity.type,
        entity.type === "ground_item"
          ? String(entity.properties.itemId ?? "")
          : undefined,
      );
      const container = new Container();
      const shadow = new Graphics();
      const visual = new Sprite(textures.frames[0]);
      visual.anchor.set(0.5, textures.anchorY);
      visual.scale.set(ENTITY_SCALE);
      visual.roundPixels = true;
      container.addChild(shadow);
      container.addChild(visual);

      sprite = { entity, container, shadow, sprite: visual, textures };
      this.entitySprites.set(entity.id, sprite);
      this.worldObjectContainer.addChild(container);
    }

    sprite.entity = entity;
    sprite.container.x = entity.x * TILE_SIZE + TILE_SIZE / 2;
    sprite.container.y = entity.y * TILE_SIZE + TILE_SIZE * 0.9;
    sprite.container.zIndex = Math.round(sprite.container.y);
    sprite.shadow.clear();
    sprite.shadow.ellipse(0, 3, TILE_SIZE * 0.16, TILE_SIZE * 0.09);
    sprite.shadow.fill({ color: 0x000000, alpha: 0.16 });
    sprite.sprite.alpha =
      entity.type === "berry_bush" && entity.properties.berries === 0
        ? 0.45
        : 1;
  }

  private createStaticEntitySprite(
    textures: EntityTextureSet,
    tileX: number,
    tileY: number,
  ): Container {
    const container = new Container();
    const shadow = new Graphics();
    shadow.ellipse(0, 3, TILE_SIZE * 0.16, TILE_SIZE * 0.09);
    shadow.fill({ color: 0x000000, alpha: 0.16 });

    const sprite = new Sprite(textures.frames[0]);
    sprite.anchor.set(0.5, textures.anchorY);
    sprite.scale.set(ENTITY_SCALE);
    sprite.roundPixels = true;

    container.addChild(shadow);
    container.addChild(sprite);
    container.x = tileX * TILE_SIZE + TILE_SIZE / 2;
    container.y = tileY * TILE_SIZE + TILE_SIZE * 0.9;
    container.zIndex = Math.round(container.y);
    this.registerAnimatedSprite(
      sprite,
      textures.frames,
      hashCoord(tileX * 10, tileY * 10, 991),
      320,
    );
    return container;
  }

  private updateAnimatedEntities(now: number): void {
    for (const sprite of this.entitySprites.values()) {
      const frameIndex =
        sprite.textures.frames.length > 1
          ? Math.floor(now / 280) % sprite.textures.frames.length
          : 0;
      sprite.sprite.texture = sprite.textures.frames[frameIndex];
    }

    for (const animated of this.animatedSprites) {
      const frameIndex =
        Math.floor((now + animated.phaseMs) / animated.frameDurationMs) %
        animated.frames.length;
      animated.sprite.texture = animated.frames[frameIndex];
    }
  }

  private renderNeedBars(npcId: string): void {
    const sprite = this.playerSprites.get(npcId);
    const needs = this.npcNeeds.get(npcId);
    if (!sprite || !needs) return;

    if (sprite.needBars) {
      sprite.container.removeChild(sprite.needBars);
    }

    const bars = new Container();
    const rows: Array<{ value: number; color: number }> = [
      { value: needs.health, color: 0xd55454 },
      { value: needs.food, color: 0xf0b44c },
      { value: needs.water, color: 0x6ac4de },
      { value: needs.social, color: 0x7ac96f },
    ];

    rows.forEach((row, index) => {
      const y = -TILE_SIZE * 0.62 - index * 6;
      const background = new Graphics();
      background.rect(-16, y, 32, 4);
      background.fill({ color: 0x3d2f26, alpha: 0.55 });

      const fill = new Graphics();
      fill.rect(-16, y, (row.value / 100) * 32, 4);
      fill.fill(row.color);

      bars.addChild(background);
      bars.addChild(fill);
    });

    sprite.container.addChild(bars);
    sprite.needBars = bars;
  }

  private updateWaitingIndicator(sprite: PlayerSprite, waiting: boolean): void {
    if (!waiting) {
      if (sprite.waitingIndicator) {
        sprite.container.removeChild(sprite.waitingIndicator);
        sprite.waitingIndicator = null;
      }
      return;
    }

    if (sprite.waitingIndicator) return;

    const indicator = new Container();
    const background = new Graphics();
    background.roundRect(-16, -12, 32, 20, 8);
    background.fill(0xf7ebc6);
    background.stroke({ color: 0x8d6a47, width: 2 });

    const dots = new Text({
      text: "...",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 14,
        fontWeight: "700",
        fill: 0x3b2b20,
      }),
    });
    dots.anchor.set(0.5, 0.5);
    dots.y = -2;

    indicator.addChild(background);
    indicator.addChild(dots);
    indicator.y = -TILE_SIZE * 0.92;
    sprite.container.addChild(indicator);
    sprite.waitingIndicator = indicator;
  }

  private animateScene(now: number): void {
    if (!this.mapTiles) return;

    this.updateAnimatedEntities(now);

    for (const swaying of this.swayingSprites) {
      const offset =
        Math.sin(now / swaying.rate + swaying.phase) * swaying.amplitude;
      swaying.sprite.x = Math.round(swaying.baseX + offset);
    }

    this.renderAmbientOverlay(now);
  }

  private applyCamera(self: Player): void {
    const viewportWidth = this.app.renderer.width;
    const viewportHeight = this.app.renderer.height;
    const actorX = self.x * TILE_SIZE + TILE_SIZE / 2;
    const actorY = self.y * TILE_SIZE + TILE_SIZE / 2 + TILE_SIZE * 0.18;
    const facing = orientationVector(self.orientation);
    const targetX = actorX + facing.x * LOOK_AHEAD_PX;
    const targetY = actorY + facing.y * LOOK_AHEAD_PX * 0.65;

    const desiredX = this.clampCameraAxis(
      targetX - viewportWidth / 2,
      this.worldPixelWidth,
      viewportWidth,
    );
    const desiredY = this.clampCameraAxis(
      targetY - viewportHeight / 2,
      this.worldPixelHeight,
      viewportHeight,
    );

    this.cameraX += (desiredX - this.cameraX) * 0.14;
    this.cameraY += (desiredY - this.cameraY) * 0.14;

    this.worldContainer.x = Math.round(-this.cameraX);
    this.worldContainer.y = Math.round(-this.cameraY);
  }

  private centerCameraOnWorld(): void {
    const viewportWidth = this.app.renderer.width;
    const viewportHeight = this.app.renderer.height;
    const focalX = this.worldPixelWidth / 2 + TILE_SIZE * 0.2;
    const focalY = Math.min(this.worldPixelHeight / 2, TILE_SIZE * 9.2);
    const centeredX = this.clampCameraAxis(
      focalX - viewportWidth / 2,
      this.worldPixelWidth,
      viewportWidth,
    );
    const centeredY = this.clampCameraAxis(
      focalY - viewportHeight / 2,
      this.worldPixelHeight,
      viewportHeight,
    );

    this.cameraX = centeredX;
    this.cameraY = centeredY;
    this.worldContainer.x = Math.round(-this.cameraX);
    this.worldContainer.y = Math.round(-this.cameraY);
  }

  private clampCameraAxis(
    position: number,
    worldSize: number,
    viewportSize: number,
  ): number {
    if (worldSize <= viewportSize) {
      return -(viewportSize - worldSize) / 2;
    }
    return Math.max(0, Math.min(position, worldSize - viewportSize));
  }

  private animationStateForPlayer(player: Player): ActorAnimationState {
    if (player.currentConvoId) return "talk";
    const moving =
      Math.abs(player.vx) > 0.01 ||
      Math.abs(player.vy) > 0.01 ||
      player.state === "walking";
    return moving ? "walk" : "idle";
  }

  private conversationFacingOrientation(
    player: Player,
    players: Player[],
  ): Orientation {
    if (!player.currentConvoId) {
      return player.orientation;
    }

    const partner = players.find(
      (candidate) =>
        candidate.id !== player.id &&
        candidate.currentConvoId === player.currentConvoId,
    );
    if (!partner) {
      return player.orientation;
    }

    const dx = partner.x - player.x;
    const dy = partner.y - player.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx >= 0 ? "right" : "left";
    }
    return dy >= 0 ? "down" : "up";
  }

  private pickGroundTexture(x: number, y: number): Texture {
    return this.pickTerrainTexture(
      this.requireTerrainTextures().grass,
      hashCoord(x, y, 41),
    );
  }

  private pickPathTexture(
    surface: PathSurfaceType,
    x: number,
    y: number,
  ): Texture {
    const textures = this.requireTerrainTextures();
    const seed = hashCoord(x, y, 91);
    if (surface === "cobble") {
      return this.pickTerrainTexture(textures.cobble, seed);
    }
    if (surface === "track") {
      return this.pickTerrainTexture(textures.track, seed);
    }
    if (surface === "tilled") {
      return this.pickTerrainTexture(textures.tilled, seed);
    }
    return this.pickTerrainTexture(textures.dirt, seed);
  }

  private pickTile(options: TileCoord[], seed: number): Texture {
    return this.atlasTexture(this.pickCoord(options, seed));
  }

  private pickTerrainTexture(options: Texture[], seed: number): Texture {
    return options[seed % options.length];
  }

  private requireTerrainTextures(): TerrainTextureSet {
    if (!this.terrainTextures) {
      throw new Error("Terrain textures unavailable");
    }
    return this.terrainTextures;
  }

  private syncNamePlate(sprite: PlayerSprite, isSelf: boolean): void {
    const plateWidth = Math.max(42, Math.ceil(sprite.nameLabel.width) + 14);
    const plateHeight = 18;
    const plateTop = sprite.nameLabel.y - plateHeight + 4;
    sprite.namePlate.clear();
    sprite.namePlate.roundRect(
      -plateWidth / 2,
      plateTop,
      plateWidth,
      plateHeight,
      6,
    );
    sprite.namePlate.fill({
      color: isSelf ? 0x5b452f : 0x3d2f23,
      alpha: isSelf ? 0.86 : 0.72,
    });
    sprite.namePlate.stroke({
      color: isSelf ? 0xf2d48d : 0xc9b282,
      width: 2,
      alpha: 0.94,
    });
  }

  private registerAnimatedSprite(
    sprite: Sprite,
    frames: Texture[],
    seed: number,
    frameDurationMs: number,
  ): void {
    if (frames.length < 2) return;
    this.animatedSprites.push({
      sprite,
      frames,
      phaseMs: seed % frameDurationMs,
      frameDurationMs,
    });
  }

  private registerSwaySprite(
    sprite: Sprite,
    baseX: number,
    seed: number,
    amplitude: number,
    rate: number,
  ): void {
    this.swayingSprites.push({
      sprite,
      baseX,
      phase: (seed % 628) / 100,
      amplitude,
      rate,
    });
  }

  private renderAmbientOverlay(now: number): void {
    this.ambientOverlay.clear();

    this.ambientOverlay.rect(0, 0, this.worldPixelWidth, this.worldPixelHeight);
    this.ambientOverlay.fill({ color: 0xf5efcb, alpha: 0.035 });

    const sunShift = Math.sin(now / 4200) * TILE_SIZE * 0.4;
    this.ambientOverlay.ellipse(
      TILE_SIZE * 6.5 + sunShift,
      TILE_SIZE * 5.2,
      TILE_SIZE * 5.8,
      TILE_SIZE * 3.1,
    );
    this.ambientOverlay.fill({ color: 0xfff4c0, alpha: 0.065 });

    const cloudOneX =
      ((now * 0.024) % (this.worldPixelWidth + TILE_SIZE * 12)) - TILE_SIZE * 6;
    const cloudTwoX =
      this.worldPixelWidth -
      (((now * 0.019) % (this.worldPixelWidth + TILE_SIZE * 10)) -
        TILE_SIZE * 5);

    this.ambientOverlay.ellipse(
      cloudOneX,
      TILE_SIZE * 8.2,
      TILE_SIZE * 3.2,
      TILE_SIZE * 1.6,
    );
    this.ambientOverlay.fill({ color: 0x5c7d4b, alpha: 0.055 });

    this.ambientOverlay.ellipse(
      cloudTwoX,
      TILE_SIZE * 13.4,
      TILE_SIZE * 2.9,
      TILE_SIZE * 1.4,
    );
    this.ambientOverlay.fill({ color: 0x4f7146, alpha: 0.045 });

    this.ambientOverlay.rect(0, 0, this.worldPixelWidth, TILE_SIZE * 0.6);
    this.ambientOverlay.fill({ color: 0xffffff, alpha: 0.06 });
  }

  private pickCoord(options: TileCoord[], seed: number): TileCoord {
    return options[seed % options.length];
  }

  private atlasTexture(coord: TileCoord): Texture {
    if (!this.atlas) {
      throw new Error("Atlas texture unavailable");
    }

    return new Texture({
      source: this.atlas.source,
      frame: new Rectangle(
        coord.col * (TILE_SOURCE_SIZE + TILE_GAP),
        coord.row * (TILE_SOURCE_SIZE + TILE_GAP),
        TILE_SOURCE_SIZE,
        TILE_SOURCE_SIZE,
      ),
    });
  }

  private atlasPixelTexture(
    col: number,
    row: number,
    pixelX: number,
    pixelY: number,
    width: number,
    height: number,
  ): Texture {
    if (!this.atlas) {
      throw new Error("Atlas texture unavailable");
    }

    return new Texture({
      source: this.atlas.source,
      frame: new Rectangle(
        col * (TILE_SOURCE_SIZE + TILE_GAP) + pixelX,
        row * (TILE_SOURCE_SIZE + TILE_GAP) + pixelY,
        width,
        height,
      ),
    });
  }

  private isPathTile(x: number, y: number): boolean {
    if (this.tileAt(x, y) !== "floor") return false;
    const centerX = Math.floor(this.mapWidth / 2);
    const westApproach =
      (y === 8 && x >= 1 && x <= 3) || (y === 9 && x >= 4 && x <= 6);
    const plazaSpine =
      (y === 10 && x >= 7 && x <= 12) ||
      (y === 11 && x >= centerX - 1 && x <= centerX + 1);
    const eastApproach =
      (y === 9 && x >= 13 && x <= 15) || (y === 8 && x >= 16 && x <= 18);
    const northTrack =
      (x === centerX && y >= 1 && y <= 4) ||
      (x === centerX - 1 && y === 5) ||
      (x === centerX - 2 && y >= 6 && y <= 8) ||
      (x === centerX - 1 && y === 9);
    const southTrack =
      (x === centerX && y === 12) ||
      (x === centerX - 1 && y >= 13 && y <= 15) ||
      (x === centerX - 2 && y >= 16 && y <= 17);
    const leftFarm =
      (y === 5 && x >= 2 && x <= 4) || (x === 4 && y >= 6 && y <= 8);
    const rightFarm =
      (y === 5 && x >= this.mapWidth - 5 && x <= this.mapWidth - 3) ||
      (x === this.mapWidth - 5 && y >= 6 && y <= 7) ||
      (x === this.mapWidth - 4 && y === 8);
    const southPorch =
      (y === 15 && x >= centerX - 2 && x <= centerX - 1) ||
      (y === 16 && x === centerX - 2);
    return (
      westApproach ||
      plazaSpine ||
      eastApproach ||
      northTrack ||
      southTrack ||
      leftFarm ||
      rightFarm ||
      southPorch
    );
  }

  private pathSurfaceType(x: number, y: number): PathSurfaceType {
    if (this.isPlazaTile(x, y)) {
      return "cobble";
    }
    if (this.isCultivatedStripTile(x, y)) {
      return "tilled";
    }
    if (this.isMeadowTrackTile(x, y)) {
      return "track";
    }
    return "dirt";
  }

  private isPlazaTile(x: number, y: number): boolean {
    return (y === 10 && x >= 8 && x <= 12) || (y === 11 && x >= 8 && x <= 11);
  }

  private isCultivatedStripTile(x: number, y: number): boolean {
    const centerX = Math.floor(this.mapWidth / 2);
    return (
      (x === centerX - 1 && y >= 13 && y <= 15) ||
      (x === centerX - 2 && y >= 15 && y <= 17) ||
      (y === 15 && x >= centerX - 2 && x <= centerX - 1) ||
      (y === 5 && x >= 2 && x <= 4) ||
      (y === 5 && x >= this.mapWidth - 5 && x <= this.mapWidth - 3)
    );
  }

  private isMeadowTrackTile(x: number, y: number): boolean {
    return (
      (y === 8 && x >= 1 && x <= 3) ||
      (y === 9 && x >= 4 && x <= 6) ||
      (y === 9 && x >= 13 && x <= 15) ||
      (y === 8 && x >= 16 && x <= 18) ||
      (x === Math.floor(this.mapWidth / 2) - 2 && y >= 6 && y <= 8)
    );
  }

  private isPondBankTile(x: number, y: number): boolean {
    if (this.tileAt(x, y) !== "floor") return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.tileAt(x + dx, y + dy) === "water") {
          return true;
        }
      }
    }
    return false;
  }

  private tileAt(x: number, y: number): TileType | null {
    if (!this.mapTiles) return null;
    if (
      y < 0 ||
      y >= this.mapTiles.length ||
      x < 0 ||
      x >= (this.mapTiles[0]?.length ?? 0)
    ) {
      return null;
    }
    return this.mapTiles[y][x];
  }
}
