import { describe, expect, it } from 'vitest';
import {
  GCM_TAG_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_FILES_PER_MESSAGE,
  MAX_THUMBNAIL_BYTES,
} from './limits';

// Contract: backend/src/media/opaque-blob.spec.ts pins the same literals against OPAQUE_MAX_BYTES.
describe('attachment limits contract', () => {
  it('matches the backend opaque-blob caps (tag included)', () => {
    expect(MAX_ATTACHMENT_BYTES + GCM_TAG_BYTES).toBe(26_214_400);
    expect(MAX_THUMBNAIL_BYTES + GCM_TAG_BYTES).toBe(524_288);
    expect(MAX_FILES_PER_MESSAGE).toBe(10);
  });
});
