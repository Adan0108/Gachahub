import { Module } from '@nestjs/common';
import { WebsocketModule } from '../websocket/websocket.module';
import { SessionTerminator } from './session-terminator.service';

@Module({
  imports: [WebsocketModule],
  providers: [SessionTerminator],
  exports: [SessionTerminator],
})
export class SessionTerminatorModule {}
