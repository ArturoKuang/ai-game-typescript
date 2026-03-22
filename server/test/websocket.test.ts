import { describe, expect, it } from 'vitest';
import type { ServerMessage, ClientMessage, FullGameState } from '../src/network/protocol.js';

describe('WebSocket Protocol Types', () => {
  it('server messages have correct structure', () => {
    const stateMsg: ServerMessage = {
      type: 'state',
      data: {
        tick: 0,
        world: { width: 20, height: 20 },
        players: [],
        conversations: [],
        activities: [],
      },
    };
    expect(stateMsg.type).toBe('state');
    expect((stateMsg.data as FullGameState).tick).toBe(0);
  });

  it('client messages have correct structure', () => {
    const joinMsg: ClientMessage = {
      type: 'join',
      data: { name: 'Test Player' },
    };
    expect(joinMsg.type).toBe('join');

    const moveMsg: ClientMessage = {
      type: 'move',
      data: { x: 5, y: 10 },
    };
    expect(moveMsg.type).toBe('move');

    const sayMsg: ClientMessage = {
      type: 'say',
      data: { content: 'Hello!' },
    };
    expect(sayMsg.type).toBe('say');

    const startConvo: ClientMessage = {
      type: 'start_convo',
      data: { targetId: 'npc_alice' },
    };
    expect(startConvo.type).toBe('start_convo');

    const endConvo: ClientMessage = { type: 'end_convo' };
    expect(endConvo.type).toBe('end_convo');

    const ping: ClientMessage = { type: 'ping' };
    expect(ping.type).toBe('ping');
  });
});
