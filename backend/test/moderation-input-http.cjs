// Native Node runner loads the real ESM Better Auth guard (Jest's CJS mocks cannot).
// Run after npm run build. HTTP is real; repository and session provider are fixtures.
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { Reflector } = require('@nestjs/core');
const { AuthGuard } = require('@thallesp/nestjs-better-auth');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const {
  ModerationResultsModule,
} = require('../dist/src/moderation-analysis/moderation-results.module');
const {
  ModerationResultConsumer,
} = require('../dist/src/moderation-analysis/moderation-result-consumer.service');
const {
  ModerationAnalysisInternalController,
} = require('../dist/src/moderation-analysis/moderation-analysis-internal.controller');
const { PrismaService } = require('../dist/src/prisma/prisma.service');
const {
  hashTextInput,
} = require('../dist/src/moderation-analysis/canonical-text-input');

async function main() {
  process.env.MODERATION_WORKER_TOKEN = 'test-only-' + 'a'.repeat(32);
  const input = { type: 'POST', title: null, content: 'immutable fixture' };
  let row = {
    id: 'job',
    caseId: 'case',
    generation: 1,
    targetType: 'POST',
    targetId: 'post',
    inputSchemaVersion: 1,
    inputSnapshot: input,
    snapshotHash: hashTextInput(input),
    classifierProfile: 'moderation-text-v1',
  };
  const testing = await Test.createTestingModule({
    imports: [ModerationResultsModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ moderationAnalysis: { findUnique: async () => row } })
    .overrideProvider(ModerationResultConsumer)
    .useValue({})
    .compile();
  const app = testing.createNestApplication({ logger: false });
  const realGuard = new AuthGuard(new Reflector(), {
    auth: { api: { getSession: async () => null } },
  });
  app.useGlobalGuards(realGuard);
  await app.listen(0, '127.0.0.1');
  let assertions = 0;
  const check = (actual, expected) => {
    assert.deepEqual(actual, expected);
    assertions++;
  };
  try {
    const url =
      (await app.getUrl()) + '/internal/moderation/analyses/job/input';
    for (const token of [null, 'wrong', process.env.MODERATION_WORKER_TOKEN]) {
      const response = await fetch(url, {
        headers: token ? { authorization: 'Bearer ' + token } : {},
      });
      check(
        response.status,
        token === process.env.MODERATION_WORKER_TOKEN ? 200 : 401,
      );
      check(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      if (response.status === 200) {
        check(body.input, input);
        check(
          Object.keys(body).sort(),
          [
            'analysisJobId',
            'caseId',
            'generation',
            'targetType',
            'targetId',
            'inputSchemaVersion',
            'snapshotHash',
            'classifierProfile',
            'input',
          ].sort(),
        );
      }
    }
    const validHeaders = {
      authorization: 'Bearer ' + process.env.MODERATION_WORKER_TOKEN,
    };
    let response = await fetch(url.replace('/job/', '/bad%20id/'), {
      headers: validHeaders,
    });
    check(response.status, 400);
    row = null;
    response = await fetch(url, { headers: validHeaders });
    check(response.status, 404);
    check(response.headers.get('cache-control'), 'no-store');
    row = {
      inputSnapshot: { type: 'COMMENT', content: 'bad' },
      inputSchemaVersion: 2,
    };
    response = await fetch(url, { headers: validHeaders });
    check(response.status, 500);
    check(response.headers.get('cache-control'), 'no-store');
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    check(
      Object.keys(document.paths).some((path) => path.startsWith('/internal/')),
      false,
    );
    console.log(
      `PASS real Better Auth guard + HTTP API: ${assertions} assertions; session/repository fixture only`,
    );
  } finally {
    await app.close();
  }
}
main().catch(() => {
  console.error('FAIL moderation input HTTP verification');
  process.exitCode = 1;
});
