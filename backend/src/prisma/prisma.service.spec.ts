import { PrismaService } from './prisma.service';

const mockCaptured: { options?: unknown } = {};

// Runs when prisma.service first imports it, i.e. before that file reads DATABASE_URL.
jest.mock('dotenv/config', () => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  return {};
});
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));
jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      mockCaptured.options = options;
    }
  },
}));

describe('PrismaService', () => {
  it('gives every interactive transaction a 15s timeout by default', () => {
    new PrismaService();

    expect(mockCaptured.options).toMatchObject({
      transactionOptions: { maxWait: 5_000, timeout: 15_000 },
    });
  });
});
