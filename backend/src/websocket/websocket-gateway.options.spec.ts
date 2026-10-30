jest.mock('../config/app.config', () => ({
  appConfig: { trustedOrigins: ['https://trusted.example'] },
}));
import { websocketGatewayOptions } from './websocket-gateway.options';

it.each([
  ['https://trusted.example', true],
  ['https://evil.example', false],
  [undefined, false],
  ['null', false],
])('authorizes WebSocket handshake Origin %s', (origin, allowed) => {
  const done = jest.fn();
  websocketGatewayOptions.allowRequest({ headers: { origin } } as never, done);
  expect(done).toHaveBeenCalledWith(null, allowed);
});
