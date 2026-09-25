import { SocketRegistry } from './socket-registry.service';

describe('SocketRegistry.endSessions', () => {
  it('tells each login it is signed out, then closes its sockets', () => {
    const room = { emit: jest.fn(), disconnectSockets: jest.fn() };
    const server = { in: jest.fn().mockReturnValue(room) };
    const registry = new SocketRegistry();
    registry.server = server as never;

    registry.endSessions(['s1', 's2']);

    expect(server.in).toHaveBeenCalledWith('session:s1');
    expect(server.in).toHaveBeenCalledWith('session:s2');
    expect(room.emit).toHaveBeenCalledTimes(2);
    expect(room.emit).toHaveBeenCalledWith('session:revoked');
    expect(room.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('does nothing before the server exists', () => {
    expect(() => new SocketRegistry().endSessions(['s1'])).not.toThrow();
  });
});
