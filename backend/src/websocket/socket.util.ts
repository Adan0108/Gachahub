// shared per-user room name, any gateway or service can join or emit to it
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

// one room per login, so a revoked login's sockets can be reached and closed
export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}
