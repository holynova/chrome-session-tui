import {describe, expect, it} from 'vitest';
import {formatSessionPrimaryRow, formatTableHeader, visibleWidth} from './format.js';
import type {ChromeSession} from './types.js';

const session: ChromeSession = {
  id: 'chrome-12345',
  pid: 12345,
  ppid: 1,
  kind: 'automation',
  label: 'Chrome DevTools 自动化',
  source: 'Chrome DevTools',
  reason: '远程调试参数',
  controllerShared: false,
  processCount: 6,
  childCount: 5,
  windowCount: 2,
  tabCount: 11,
  windowInspection: 'cdp',
  windowInspectionMessage: 'CDP · 127.0.0.1:9222',
  canMergeWindows: false,
  rssMb: 571.2,
  cpuPercent: 0.1,
  uptimeSeconds: 80,
  startedAt: '2026-08-01T00:00:00.000Z',
  protected: false,
  command: 'Google Chrome --remote-debugging-port=9222',
  processes: [],
};

describe('TUI formatting', () => {
  it('uses terminal cell width rather than JavaScript string length for CJK', () => {
    expect(visibleWidth('正常')).toBe(4);
    expect(visibleWidth('AI/自动化')).toBe(9);
  });

  it('keeps the table header and rows on one shared grid', () => {
    const width = 78;
    expect(visibleWidth(formatTableHeader(width))).toBe(width);
    expect(visibleWidth(formatSessionPrimaryRow(session, false, width))).toBe(width);
  });
});
