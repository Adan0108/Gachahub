// shared per-user room name, any gateway or service can join or emit to it
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
