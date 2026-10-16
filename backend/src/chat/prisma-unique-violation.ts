import { Prisma } from '../generated/prisma/client';

/** The column names a unique-constraint error says clashed, from whichever shape this Prisma setup reports them in. */
function clashedFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: {
          cause?: { constraint?: { fields?: unknown } };
        };
      }
    | undefined;

  // Classic engine: `target`. Driver adapters (pg): the fields sit in the adapter error, quoted.
  const fromTarget = meta?.target;
  const fromAdapter = meta?.driverAdapterError?.cause?.constraint?.fields;

  const names: string[] = [];
  for (const source of [fromTarget, fromAdapter]) {
    if (Array.isArray(source)) {
      names.push(...source.map((name) => String(name).replace(/^"|"$/g, '')));
    } else if (typeof source === 'string') {
      names.push(source);
    }
  }
  return names;
}

/** True for a Prisma unique-constraint violation (P2002) on the given field. */
export function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }

  return clashedFields(error).some(
    (name) => name === field || name.includes(field),
  );
}
