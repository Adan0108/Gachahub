import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

// shared server ref, breaks gateway <-> delivery-service circular dependencies
@Injectable()
export class SocketRegistry {
  server?: Server;
}
