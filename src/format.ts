import type {ChromeSession, SessionKind} from './types.js';

const COLUMN_GAP = 2;
const ROW_PREFIX_WIDTH = 2;

const MAX_COLUMN_WIDTHS = [10, 7, 7, 7, 9, 7, 8, 7];
const MIN_COLUMN_WIDTHS = [8, 6, 6, 5, 8, 6, 6, 6];
const COLUMN_HEADERS = ['类型', 'PID', '窗口', 'Tab', 'RSS', 'CPU', '进程', '状态'];

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  if (minutes > 0) return `${minutes}分${remainingSeconds}秒`;
  return `${remainingSeconds}秒`;
}

export function formatKind(kind: SessionKind): string {
  if (kind === 'normal') return '正常';
  if (kind === 'headless') return 'Headless';
  if (kind === 'automation') return 'AI/自动化';
  return '未知';
}

export function visibleWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0x300 && codePoint <= 0x36f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) continue;
    if (
      codePoint >= 0x1100 && (
        codePoint <= 0x115f ||
        codePoint === 0x2329 ||
        codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0x1f300 && codePoint <= 0x1faff)
      )
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function truncateToWidth(value: string, width: number): string {
  if (width <= 0) return '';
  let result = '';
  let currentWidth = 0;
  for (const character of value) {
    const characterWidth = visibleWidth(character);
    if (currentWidth + characterWidth > width) break;
    result += character;
    currentWidth += characterWidth;
  }
  return result;
}

function fitCell(value: string, width: number, align: 'left' | 'right'): string {
  const fitted = truncateToWidth(value, width);
  const padding = Math.max(0, width - visibleWidth(fitted));
  return align === 'right' ? `${' '.repeat(padding)}${fitted}` : `${fitted}${' '.repeat(padding)}`;
}

function rowWidth(widths: number[]): number {
  return ROW_PREFIX_WIDTH + widths.reduce((sum, width) => sum + width, 0) + COLUMN_GAP * (widths.length - 1);
}

function columnWidths(availableWidth: number): number[] {
  const widths = [...MAX_COLUMN_WIDTHS];
  const target = Math.max(rowWidth(MIN_COLUMN_WIDTHS), availableWidth);
  let overflow = rowWidth(widths) - target;
  while (overflow > 0) {
    let changed = false;
    for (let index = 0; index < widths.length && overflow > 0; index += 1) {
      if (widths[index] > MIN_COLUMN_WIDTHS[index]) {
        widths[index] -= 1;
        overflow -= 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return widths;
}

function formatMetricCells(session: ChromeSession, widths: number[]): string[] {
  const values = [
    formatKind(session.kind),
    String(session.pid),
    session.windowCount === null ? '—' : String(session.windowCount),
    session.tabCount === null ? '—' : String(session.tabCount),
    `${session.rssMb.toFixed(0)} MB`,
    `${session.cpuPercent.toFixed(1)}%`,
    String(session.processCount),
    session.protected ? '保护' : '可关闭',
  ];
  const alignments: Array<'left' | 'right'> = ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'left'];
  return values.map((value, index) => fitCell(value, widths[index], alignments[index]));
}

function inspectionLabel(session: ChromeSession): string {
  if (session.windowInspection === 'applescript') return 'AppleScript，可合并';
  if (session.windowInspection === 'cdp') return 'CDP，只读';
  if (session.windowInspection === 'error') return session.windowInspectionMessage ?? '读取失败';
  return session.windowInspectionMessage ?? '窗口数据不可用';
}

export function formatTableHeader(availableWidth = 100): string {
  const widths = columnWidths(availableWidth);
  return `  ${COLUMN_HEADERS.map((header, index) => fitCell(header, widths[index], index === 0 || index === 7 ? 'left' : 'right')).join(' '.repeat(COLUMN_GAP))}`;
}

export function formatSessionPrimaryRow(session: ChromeSession, selected = false, availableWidth = 100): string {
  const widths = columnWidths(availableWidth);
  const prefix = selected ? '▸ ' : '  ';
  return `${prefix}${formatMetricCells(session, widths).join(' '.repeat(COLUMN_GAP))}`;
}

export function formatSessionSecondaryRow(session: ChromeSession, availableWidth = 100): string {
  const label = `${session.label} — ${inspectionLabel(session)}`;
  return `  └─ ${truncateToWidth(label, Math.max(0, availableWidth - 6))}`;
}

export function formatTable(sessions: ChromeSession[], availableWidth = 100): string {
  if (sessions.length === 0) return '没有发现 Chrome 浏览器主会话。请先打开 Chrome，或确认终端有权查看进程。';
  const lines = [formatTableHeader(availableWidth)];
  for (const session of sessions) {
    lines.push(formatSessionPrimaryRow(session, false, availableWidth));
    lines.push(formatSessionSecondaryRow(session, availableWidth));
  }
  return lines.join('\n');
}

export function formatWindowSummary(session: ChromeSession): string {
  const windows = session.windowCount === null ? '—' : String(session.windowCount);
  const tabs = session.tabCount === null ? '—' : String(session.tabCount);
  return `${windows} 个窗口、${tabs} 个 Tab`;
}
