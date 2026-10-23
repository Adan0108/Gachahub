import { Module } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway';
import { SocketRegistry } from './socket-registry.service';
import { SocketSessionWatcher } from './socket-session-watcher.service';

/**
 * Generic WebSocket infrastructure module.
 *
 * Provides connection/auth handling and the shared server registry so any
 * feature module can add its own gateway on top without redoing this setup.
 */
@Module({
  providers: [WebsocketGateway, SocketRegistry, SocketSessionWatcher],
  exports: [SocketRegistry],
})
export class WebsocketModule {}
