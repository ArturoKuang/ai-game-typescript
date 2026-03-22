import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Activity, Player, TileType } from "./types.js";

const TILE_SIZE = 32;

const TILE_COLORS: Record<TileType, number> = {
  floor: 0x2d2d3d,
  wall: 0x4a3728,
  water: 0x1a4a6e,
};

const NPC_COLOR = 0x48c9b0;
const HUMAN_COLOR = 0x5dade2;
const SELF_COLOR = 0xf7dc6f;
const CONVO_LINE_COLOR = 0xe94560;

interface PlayerSprite {
  container: Container;
  circle: Graphics;
  nameLabel: Text;
  chatBubble: Container | null;
  chatTimeout: ReturnType<typeof setTimeout> | null;
}

export class GameRenderer {
  private app: Application;
  private tileContainer: Container = new Container();
  private activityContainer: Container = new Container();
  private playerContainer: Container = new Container();
  private lineContainer: Container = new Container();
  private playerSprites: Map<string, PlayerSprite> = new Map();
  private mapWidth = 0;
  private mapHeight = 0;
  private selfId: string | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.app = new Application();
  }

  async init(): Promise<void> {
    await this.app.init({
      canvas: this.canvas,
      width: 640,
      height: 640,
      backgroundColor: 0x1a1a2e,
      antialias: true,
    });
    this.app.stage.addChild(this.tileContainer);
    this.app.stage.addChild(this.activityContainer);
    this.app.stage.addChild(this.lineContainer);
    this.app.stage.addChild(this.playerContainer);
  }

  setSelfId(id: string): void {
    this.selfId = id;
  }

  renderMap(tiles: TileType[][], activities: Activity[]): void {
    this.tileContainer.removeChildren();
    this.activityContainer.removeChildren();
    this.mapWidth = tiles[0]?.length ?? 0;
    this.mapHeight = tiles.length;

    // Resize canvas to fit map
    const w = this.mapWidth * TILE_SIZE;
    const h = this.mapHeight * TILE_SIZE;
    this.app.renderer.resize(w, h);

    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        const tileType = tiles[y][x];
        const g = new Graphics();
        g.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        g.fill(TILE_COLORS[tileType] ?? 0x333333);
        // Subtle grid line
        g.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        g.stroke({ width: 0.5, color: 0x3a3a4a });
        this.tileContainer.addChild(g);
      }
    }

    // Render activities as text labels
    const actStyle = new TextStyle({ fontSize: 14, fill: 0xffffff });
    for (const act of activities) {
      const text = new Text({ text: act.emoji, style: actStyle });
      text.x = act.x * TILE_SIZE + TILE_SIZE / 2;
      text.y = act.y * TILE_SIZE + TILE_SIZE / 2;
      text.anchor.set(0.5);
      this.activityContainer.addChild(text);
    }
  }

  updatePlayers(players: Player[]): void {
    const currentIds = new Set(players.map((p) => p.id));

    // Remove sprites for departed players
    for (const [id, sprite] of this.playerSprites) {
      if (!currentIds.has(id)) {
        this.playerContainer.removeChild(sprite.container);
        this.playerSprites.delete(id);
      }
    }

    // Update or create sprites
    for (const player of players) {
      let sprite = this.playerSprites.get(player.id);

      if (!sprite) {
        sprite = this.createPlayerSprite(player);
        this.playerSprites.set(player.id, sprite);
        this.playerContainer.addChild(sprite.container);
      }

      // Update position
      const targetX = player.x * TILE_SIZE + TILE_SIZE / 2;
      const targetY = player.y * TILE_SIZE + TILE_SIZE / 2;
      // Smooth lerp
      sprite.container.x += (targetX - sprite.container.x) * 0.3;
      sprite.container.y += (targetY - sprite.container.y) * 0.3;

      // Update color based on identity
      const color =
        player.id === this.selfId
          ? SELF_COLOR
          : player.isNpc
            ? NPC_COLOR
            : HUMAN_COLOR;
      sprite.circle.clear();
      sprite.circle.circle(0, 0, TILE_SIZE * 0.35);
      sprite.circle.fill(color);
      sprite.circle.circle(0, 0, TILE_SIZE * 0.35);
      sprite.circle.stroke({ width: 2, color: 0xffffff, alpha: 0.5 });

      // State indicator
      if (player.state === "conversing") {
        sprite.circle.circle(0, 0, TILE_SIZE * 0.42);
        sprite.circle.stroke({ width: 1.5, color: CONVO_LINE_COLOR });
      }
    }

    // Draw conversation lines
    this.lineContainer.removeChildren();
    const convoPartners = new Map<string, string>();
    for (const p of players) {
      if (p.currentConvoId) {
        const partner = players.find(
          (o) => o.id !== p.id && o.currentConvoId === p.currentConvoId,
        );
        if (partner && !convoPartners.has(partner.id)) {
          convoPartners.set(p.id, partner.id);
        }
      }
    }

    for (const [id1, id2] of convoPartners) {
      const s1 = this.playerSprites.get(id1);
      const s2 = this.playerSprites.get(id2);
      if (s1 && s2) {
        const g = new Graphics();
        g.moveTo(s1.container.x, s1.container.y);
        g.lineTo(s2.container.x, s2.container.y);
        g.stroke({ width: 2, color: CONVO_LINE_COLOR, alpha: 0.6 });
        this.lineContainer.addChild(g);
      }
    }
  }

  showChatBubble(playerId: string, content: string): void {
    const sprite = this.playerSprites.get(playerId);
    if (!sprite) return;

    // Remove existing bubble
    if (sprite.chatBubble) {
      sprite.container.removeChild(sprite.chatBubble);
      sprite.chatBubble = null;
    }
    if (sprite.chatTimeout) {
      clearTimeout(sprite.chatTimeout);
    }

    const bubble = new Container();
    const truncated =
      content.length > 40 ? `${content.slice(0, 37)}...` : content;
    const text = new Text({
      text: truncated,
      style: new TextStyle({
        fontSize: 10,
        fill: 0xffffff,
        wordWrap: true,
        wordWrapWidth: 120,
      }),
    });
    text.anchor.set(0.5, 1);

    // Background
    const bg = new Graphics();
    const padding = 4;
    bg.roundRect(
      -text.width / 2 - padding,
      -text.height - padding,
      text.width + padding * 2,
      text.height + padding * 2,
      4,
    );
    bg.fill({ color: 0x0f3460, alpha: 0.9 });

    bubble.addChild(bg);
    bubble.addChild(text);
    bubble.y = -TILE_SIZE * 0.6;

    sprite.container.addChild(bubble);
    sprite.chatBubble = bubble;

    sprite.chatTimeout = setTimeout(() => {
      if (sprite.chatBubble) {
        sprite.container.removeChild(sprite.chatBubble);
        sprite.chatBubble = null;
      }
    }, 5000);
  }

  /** Convert screen coordinates to tile coordinates */
  screenToTile(
    screenX: number,
    screenY: number,
  ): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((screenX - rect.left) / TILE_SIZE);
    const y = Math.floor((screenY - rect.top) / TILE_SIZE);
    if (x < 0 || x >= this.mapWidth || y < 0 || y >= this.mapHeight)
      return null;
    return { x, y };
  }

  private createPlayerSprite(player: Player): PlayerSprite {
    const container = new Container();

    const circle = new Graphics();
    circle.circle(0, 0, TILE_SIZE * 0.35);
    circle.fill(player.isNpc ? NPC_COLOR : HUMAN_COLOR);

    const nameLabel = new Text({
      text: player.name.split(" ")[0],
      style: new TextStyle({ fontSize: 10, fill: 0xffffff }),
    });
    nameLabel.anchor.set(0.5, 0);
    nameLabel.y = TILE_SIZE * 0.4;

    container.addChild(circle);
    container.addChild(nameLabel);

    container.x = player.x * TILE_SIZE + TILE_SIZE / 2;
    container.y = player.y * TILE_SIZE + TILE_SIZE / 2;

    return {
      container,
      circle,
      nameLabel,
      chatBubble: null,
      chatTimeout: null,
    };
  }
}
