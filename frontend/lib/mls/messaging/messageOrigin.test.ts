import { describe, expect, it } from 'vitest';
import { senderMeta, wasSentByDevice } from './messageOrigin';

describe('wasSentByDevice', () => {
  it('recognises a message this device sent', () => {
    expect(wasSentByDevice(senderMeta('phone'), 'phone')).toBe(true);
  });

  it('does not treat a message another device of the same user sent as its own', () => {
    expect(wasSentByDevice(senderMeta('phone'), 'laptop')).toBe(false);
  });

  it('does not claim a message that says nothing about where it came from', () => {
    expect(wasSentByDevice(undefined, 'phone')).toBe(false);
    expect(wasSentByDevice(null, 'phone')).toBe(false);
    expect(wasSentByDevice({}, 'phone')).toBe(false);
    expect(wasSentByDevice('phone', 'phone')).toBe(false);
  });
});
