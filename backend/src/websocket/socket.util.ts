// shared per-user room name, any gateway or service can join or emit to it
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Whether events from this socket may still be acted on: it signed in, and its login has not expired. */
export function hasLiveSession(socket: {
  data: { userId?: string; sessionExpiresAt?: number };
}): boolean {
  return (
    socket.data.userId !== undefined &&
    (socket.data.sessionExpiresAt ?? 0) > Date.now()
  );
}

// one room per login, so a revoked login's sockets can be reached and closed
export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}
