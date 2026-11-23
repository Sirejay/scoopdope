import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { NotificationType, Notification } from './notification.entity';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSocket(overrides: Record<string, any> = {}) {
  return {
    id: 'sock-1',
    join: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    data: {},
    handshake: { auth: { token: 'valid-token' }, headers: {} },
    ...overrides,
  };
}

function makeGateway(jwtOverride?: Partial<JwtService>, repoOverride?: any) {
  const jwtService = {
    verify: vi.fn().mockReturnValue({ sub: 'user-1' }),
    ...jwtOverride,
  } as unknown as JwtService;

  const configService = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;

  const repo = {
    find: vi.fn().mockResolvedValue([]),
    ...repoOverride,
  } as unknown as Repository<Notification>;

  const gateway = new NotificationsGateway(jwtService, configService, repo);
  (gateway as any).server = {
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
    adapter: vi.fn(),
  };
  return { gateway, jwtService, repo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsGateway — integration', () => {
  describe('handleConnection', () => {
    it('joins the user room and emits notifications:init on valid JWT', async () => {
      const { gateway } = makeGateway();
      const client = makeSocket();

      await gateway.handleConnection(client as any);

      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.emit).toHaveBeenCalledWith('notifications:init', []);
    });

    it('disconnects immediately when no token is provided', async () => {
      const { gateway } = makeGateway();
      const client = makeSocket({ handshake: { auth: {}, headers: {} } });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects when JWT verification throws', async () => {
      const { gateway } = makeGateway({
        verify: vi.fn().mockImplementation(() => { throw new Error('invalid signature'); }),
      });
      const client = makeSocket();

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('re-delivers unread notifications as individual notification events', async () => {
      const unread = { id: 'n-1', userId: 'user-1', message: 'Hello', isRead: false, createdAt: new Date() };
      const all = [unread];

      const { gateway } = makeGateway(undefined, {
        find: vi.fn()
          .mockResolvedValueOnce(all)   // notifications:init
          .mockResolvedValueOnce([unread]), // unread re-delivery
      });
      const client = makeSocket();

      await gateway.handleConnection(client as any);

      expect(client.emit).toHaveBeenCalledWith('notification', unread);
    });
  });

  describe('emitToUser (notification creation → WebSocket push)', () => {
    it('emits to the correct user room when a notification is created', () => {
      const { gateway } = makeGateway();
      const serverMock = (gateway as any).server;

      gateway.emitToUser('user-42', 'notification', { id: 'n-99', message: 'Test' });

      expect(serverMock.to).toHaveBeenCalledWith('user:user-42');
      expect(serverMock.emit).toHaveBeenCalledWith('notification', { id: 'n-99', message: 'Test' });
    });
  });

  describe('handleJoinRoom', () => {
    it('allows joining own room', async () => {
      const { gateway } = makeGateway();
      const client = makeSocket();
      await gateway.handleConnection(client as any);

      gateway.handleJoinRoom(client as any, 'user:user-1');

      expect(client.join).toHaveBeenCalledWith('user:user-1');
    });

    it('refuses joining another user room', async () => {
      const { gateway } = makeGateway();
      const client = makeSocket();
      await gateway.handleConnection(client as any);

      const joinCallsBefore = (client.join as any).mock.calls.length;
      gateway.handleJoinRoom(client as any, 'user:user-99');

      // No additional join call for the unauthorized room
      expect(client.join).toHaveBeenCalledTimes(joinCallsBefore);
    });
  });
});
