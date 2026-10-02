/** Prisma passes contains/startsWith values into ILIKE unescaped, so wildcards and the escape character are escaped here. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}
