import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

// shared server ref, breaks the gateway <-> delivery circular dependency
@Injectable()
export class ChatSocketRegistry {
  server?: Server;
}
