import type {ChromeSession, SessionKind} from './types.js';

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export function formatKind(kind: SessionKind): string {
  if (kind === 'normal') return '正常';
  if (kind === 'headless') return 'Headless';
  if (kind === 'automation') return 'AI/自动化';
  return '未知';
}

export function formatSessionLine(session: ChromeSession): string {
  const safety = session.protected ? '保护' : '可关闭';
  return [
    String(session.pid).padStart(6),
    formatKind(session.kind).padEnd(9),
    `${session.rssMb.toFixed(0)} MB`.padStart(8),
    `${session.cpuPercent.toFixed(1)}%`.padStart(7),
    `${session.processCount} 个进程`.padEnd(10),
    safety.padEnd(6),
    session.label,
  ].join('  ');
}

export function formatTable(sessions: ChromeSession[]): string {
  if (sessions.length === 0) return '没有发现 Chrome 浏览器主会话。';
  return [
    '   PID  类型         RSS      CPU  进程数      操作  标签',
    '-------  ---------  -------  -----  ---------  ----  ----------------',
    ...sessions.map(formatSessionLine),
  ].join('\n');
}
