// shared room name, gateway joins it delivery emits to it, keep in sync
export function chatUserRoom(userId: string): string {
  return `user:${userId}`;
}
