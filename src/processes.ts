import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import process from 'node:process';
import type {ChromeSession, CloseResult, SessionKind, SystemProcess, WindowStats} from './types.js';

const execFileAsync = promisify(execFile);

const PS_ARGS = ['-axo', 'pid=,ppid=,user=,etime=,rss=,%cpu=,command='];
const AUTOMATION_ANCESTOR = /playwright|puppeteer|chromedriver|webdriver|selenium|cliDaemon|chrome-devtools-mcp|browser automation/i;
const CHROME_COMMAND = /Google Chrome|Chromium|chrome_crashpad_handler/i;
const TEMP_PROFILE = /(?:^|\/)(?:private\/)?(?:tmp|var\/folders)\//i;

export function parseElapsed(value: string): number {
  const [dayPart, timePart] = value.includes('-') ? value.split('-', 2) : [undefined, value];
  const time = timePart.split(':').map(Number);
  const seconds = time.pop() ?? 0;
  const minutes = time.pop() ?? 0;
  const hours = time.pop() ?? 0;
  const days = dayPart ? Number(dayPart) : 0;
  return Math.max(0, days * 86400 + hours * 3600 + minutes * 60 + seconds);
}

export function parsePsLine(line: string): SystemProcess | undefined {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);
  if (!match) {
    return undefined;
  }

  const command = match[7].trim();
  const isChrome = CHROME_COMMAND.test(command);
  const isMainBrowser = /\/Contents\/MacOS\/(?:Google Chrome|Chromium)(?:\s|$)/.test(command) && !/\s--type=/i.test(command);

  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    user: match[3],
    elapsedSeconds: parseElapsed(match[4]),
    rssKb: Number(match[5]),
    cpuPercent: Number(match[6]),
    command,
    isChrome,
    isMainBrowser,
  };
}

export function parsePsOutput(output: string): SystemProcess[] {
  return output
    .split('\n')
    .map(parsePsLine)
    .filter((item): item is SystemProcess => item !== undefined);
}

function getFlagValue(command: string, flag: string): string | undefined {
  const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = command.match(new RegExp(`${escapedFlag}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|(\\S+))`));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function hasFlag(command: string, flag: string): boolean {
  const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escapedFlag}(?:=|\\s|$)`, 'i').test(command);
}

function getAncestors(processItem: SystemProcess, byPid: Map<number, SystemProcess>): SystemProcess[] {
  const ancestors: SystemProcess[] = [];
  const seen = new Set<number>();
  let parent = byPid.get(processItem.ppid);

  while (parent && !seen.has(parent.pid)) {
    ancestors.push(parent);
    seen.add(parent.pid);
    parent = byPid.get(parent.ppid);
  }

  return ancestors;
}

function sourceFrom(command: string | undefined, userDataDir?: string): string {
  const combined = `${command ?? ''} ${userDataDir ?? ''}`;
  if (/chrome-devtools-mcp|devtools-mcp/i.test(combined)) return 'Chrome DevTools';
  if (!command) return '未知';
  if (/playwright/i.test(command)) return 'Playwright';
  if (/puppeteer/i.test(command)) return 'Puppeteer';
  if (/chromedriver|webdriver/i.test(command)) return 'WebDriver';
  if (/selenium/i.test(command)) return 'Selenium';
  if (/node/i.test(command)) return 'Node.js';
  return '自动化进程';
}

function classify(
  browser: SystemProcess,
  ancestors: SystemProcess[],
  userDataDir: string | undefined,
): {kind: SessionKind; reason: string; source: string; controller?: SystemProcess} {
  const controller = ancestors.find((item) => AUTOMATION_ANCESTOR.test(item.command));
  const headless = hasFlag(browser.command, '--headless') || hasFlag(browser.command, '--no-startup-window');
  const remote = hasFlag(browser.command, '--remote-debugging-pipe') || hasFlag(browser.command, '--remote-debugging-port');
  const automationFlag = hasFlag(browser.command, '--enable-automation');
  const temporaryProfile = Boolean(userDataDir && TEMP_PROFILE.test(userDataDir));

  if (headless) {
    return {
      kind: 'headless',
      reason: '带有 headless/no-startup-window 参数',
      source: sourceFrom(controller?.command, userDataDir),
      controller,
    };
  }

  if (controller || remote || automationFlag || temporaryProfile) {
    const reasons = [
      controller ? `父进程 ${sourceFrom(controller.command, userDataDir)}` : undefined,
      remote ? '远程调试参数' : undefined,
      automationFlag ? 'enable-automation 参数' : undefined,
      temporaryProfile ? '临时 user-data-dir' : undefined,
    ].filter(Boolean);
    return {
      kind: 'automation',
      reason: reasons.join('、'),
      source: sourceFrom(controller?.command, userDataDir),
      controller,
    };
  }

  return {
    kind: 'normal',
    reason: '未发现自动化或临时配置特征',
    source: '用户启动',
  };
}

function labelFor(kind: SessionKind, source: string): string {
  if (kind === 'normal') return '正常 Chrome';
  if (kind === 'headless') return `${source} Headless`;
  if (kind === 'automation') return `${source} 自动化`;
  return '未知 Chrome';
}

function descendantsOf(rootPid: number, childrenByParent: Map<number, SystemProcess[]>): SystemProcess[] {
  const result: SystemProcess[] = [];
  const queue = [...(childrenByParent.get(rootPid) ?? [])];
  const seen = new Set<number>([rootPid]);

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || seen.has(item.pid)) continue;
    seen.add(item.pid);
    result.push(item);
    queue.push(...(childrenByParent.get(item.pid) ?? []));
  }

  return result;
}

function round(value: number, digits = 1): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function buildChromeSessions(processes: SystemProcess[], now = Date.now()): ChromeSession[] {
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const childrenByParent = new Map<number, SystemProcess[]>();

  for (const item of processes) {
    const children = childrenByParent.get(item.ppid) ?? [];
    children.push(item);
    childrenByParent.set(item.ppid, children);
  }

  const roots = processes.filter((item) => item.isMainBrowser);
  const sessions = roots.map((root) => {
    const children = descendantsOf(root.pid, childrenByParent);
    const allProcesses = [root, ...children];
    const userDataDir = getFlagValue(root.command, '--user-data-dir');
    const profile = getFlagValue(root.command, '--profile-directory');
    const ancestors = getAncestors(root, byPid);
    const classification = classify(root, ancestors, userDataDir);
    const uptimeSeconds = root.elapsedSeconds;
    const rssMb = round(allProcesses.reduce((sum, item) => sum + item.rssKb, 0) / 1024);
    const cpuPercent = round(allProcesses.reduce((sum, item) => sum + item.cpuPercent, 0));
    const startedAt = new Date(now - uptimeSeconds * 1000).toISOString();
    const flags = [...root.command.matchAll(/(?:^|\s)(--[\w-]+(?:=(?:"[^"]+"|'[^']+'|\S+))?)/g)].map((match) => match[1]);

    return {
      id: `chrome-${root.pid}`,
      pid: root.pid,
      ppid: root.ppid,
      kind: classification.kind,
      label: labelFor(classification.kind, classification.source),
      source: classification.source,
      reason: classification.reason,
      profile,
      userDataDir,
      controllerPid: classification.controller?.pid,
      controllerCommand: classification.controller?.command,
      controllerShared: false as boolean,
      processCount: allProcesses.length,
      childCount: children.length,
      windowCount: null,
      tabCount: null,
      windowInspection: 'unavailable',
      windowInspectionMessage: '正在读取窗口与 Tab',
      canMergeWindows: false,
      rssMb,
      cpuPercent,
      uptimeSeconds,
      startedAt,
      protected: classification.kind === 'normal',
      command: root.command,
      processes: allProcesses,
    } satisfies ChromeSession;
  });

  const controllerCounts = new Map<number, number>();
  for (const session of sessions) {
    if (session.controllerPid) {
      controllerCounts.set(session.controllerPid, (controllerCounts.get(session.controllerPid) ?? 0) + 1);
    }
  }
  for (const session of sessions) {
    session.controllerShared = Boolean(session.controllerPid && (controllerCounts.get(session.controllerPid) ?? 0) > 1);
  }

  const kindOrder: Record<SessionKind, number> = {automation: 0, headless: 1, unknown: 2, normal: 3};
  return sessions.sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] || left.pid - right.pid);
}

export async function listSystemProcesses(): Promise<SystemProcess[]> {
  const {stdout} = await execFileAsync('/bin/ps', PS_ARGS, {maxBuffer: 8 * 1024 * 1024});
  return parsePsOutput(stdout);
}

function appNameFor(session: ChromeSession): 'Google Chrome' | 'Chromium' {
  return /Chromium/i.test(session.command) ? 'Chromium' : 'Google Chrome';
}

function unavailableWindowStats(message: string): WindowStats {
  return {
    windowCount: null,
    tabCount: null,
    windowInspection: 'unavailable',
    windowInspectionMessage: message,
    canMergeWindows: false,
  };
}

function errorWindowStats(message: string): WindowStats {
  return {
    windowCount: null,
    tabCount: null,
    windowInspection: 'error',
    windowInspectionMessage: message,
    canMergeWindows: false,
  };
}

function parseWindowStats(value: string): {windowCount: number; tabCount: number} | undefined {
  const match = value.trim().match(/^(\d+)\|(\d+)$/);
  if (!match) return undefined;
  return {windowCount: Number(match[1]), tabCount: Number(match[2])};
}

async function inspectWithAppleScript(session: ChromeSession): Promise<WindowStats> {
  const appName = appNameFor(session);
  try {
    const {stdout} = await execFileAsync('/usr/bin/osascript', ['-e', `tell application "${appName}"`, '-e', 'set windowCount to count of windows', '-e', 'set tabCount to 0', '-e', 'repeat with browserWindow in windows', '-e', 'set tabCount to tabCount + (count of tabs of browserWindow)', '-e', 'end repeat', '-e', 'return (windowCount as text) & "|" & (tabCount as text)', '-e', 'end tell'], {timeout: 1800});
    const stats = parseWindowStats(stdout);
    if (!stats) return errorWindowStats('AppleScript 返回了无法识别的窗口数据');
    return {
      ...stats,
      windowInspection: 'applescript',
      windowInspectionMessage: `AppleScript（${appName}）`,
      canMergeWindows: true,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return errorWindowStats(`无法读取 ${appName}，可能需要在「系统设置 → 隐私与安全性 → 自动化」里允许终端控制 Chrome：${detail}`);
  }
}

interface CdpTargetInfo {
  targetId: string;
  type: string;
}

interface CdpResponse<T> {
  id: number;
  result?: T;
  error?: {message?: string};
}

async function inspectWithCdp(port: number): Promise<WindowStats> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(1200)});
  if (!response.ok) throw new Error(`调试端口返回 HTTP ${response.status}`);
  const version = await response.json() as {webSocketDebuggerUrl?: string};
  if (!version.webSocketDebuggerUrl) throw new Error('调试端口没有提供 WebSocket 地址');

  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const instance = new WebSocket(version.webSocketDebuggerUrl!);
    const timeout = setTimeout(() => {
      instance.close();
      reject(new Error('连接 CDP 超时'));
    }, 1500);
    instance.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve(instance);
    }, {once: true});
    instance.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('连接 CDP 失败'));
    }, {once: true});
  });

  let nextId = 0;
  const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void}>();
  const onMessage = (event: MessageEvent) => {
    const payload = JSON.parse(String(event.data)) as CdpResponse<unknown>;
    const callback = pending.get(payload.id);
    if (!callback) return;
    pending.delete(payload.id);
    if (payload.error) callback.reject(new Error(payload.error.message ?? 'CDP 请求失败'));
    else callback.resolve(payload.result);
  };
  const onError = () => {
    for (const callback of pending.values()) callback.reject(new Error('CDP 连接中断'));
    pending.clear();
  };
  socket.addEventListener('message', onMessage);
  socket.addEventListener('error', onError);

  const request = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, {resolve: (value) => resolve(value as T), reject});
    socket.send(JSON.stringify({id, method, params}));
  });

  try {
    const targets = await request<{targetInfos: CdpTargetInfo[]}>('Target.getTargets');
    const pageTargets = targets.targetInfos.filter((target) => target.type === 'page');
    const windowIds = await Promise.all(pageTargets.map(async (target) => {
      try {
        const result = await request<{windowId: number}>('Browser.getWindowForTarget', {targetId: target.targetId});
        return result.windowId;
      } catch {
        return undefined;
      }
    }));
    const validWindowIds = windowIds.filter((windowId): windowId is number => windowId !== undefined);
    return {
      windowCount: validWindowIds.length === pageTargets.length ? new Set(validWindowIds).size : null,
      tabCount: pageTargets.length,
      windowInspection: 'cdp',
      windowInspectionMessage: `CDP 127.0.0.1:${port}`,
      canMergeWindows: false,
    };
  } finally {
    socket.close();
  }
}

async function inspectSessionWindows(session: ChromeSession): Promise<WindowStats> {
  const portValue = getFlagValue(session.command, '--remote-debugging-port');
  const port = portValue ? Number(portValue) : undefined;
  if (port && Number.isInteger(port) && port > 0 && port < 65536) {
    try {
      return await inspectWithCdp(port);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return errorWindowStats(`CDP 不可用：${detail}`);
    }
  }

  if (session.kind === 'normal') {
    return inspectWithAppleScript(session);
  }

  if (hasFlag(session.command, '--remote-debugging-pipe')) {
    const stats = unavailableWindowStats(session.kind === 'headless' ? 'Headless 无 GUI 窗口，Tab 需要 CDP pipe 才能读取' : 'remote-debugging-pipe 不暴露可连接的 TCP 端口');
    return session.kind === 'headless' ? {...stats, windowCount: 0} : stats;
  }
  return unavailableWindowStats('此会话没有可读取窗口的接口');
}

export async function mergeSessionWindows(session: ChromeSession): Promise<WindowStats> {
  if (!session.canMergeWindows) {
    throw new Error(session.windowInspectionMessage ?? '当前会话不支持窗口合并。');
  }

  const appName = appNameFor(session);
  const script = [
    `tell application "${appName}"`,
    'if (count of windows) > 1 then',
    'set targetWindow to window 1',
    'repeat while (count of windows) > 1',
    'set sourceWindow to window 2',
    'repeat while (count of tabs of sourceWindow) > 0',
    'move tab 1 of sourceWindow to end of tabs of targetWindow',
    'end repeat',
    'close sourceWindow',
    'end repeat',
    'end if',
    'return ((count of windows) as text) & "|" & ((count of tabs of window 1) as text)',
    'end tell',
  ];

  try {
    const {stdout} = await execFileAsync('/usr/bin/osascript', script.flatMap((line) => ['-e', line]), {timeout: 5000});
    const stats = parseWindowStats(stdout);
    if (!stats) throw new Error('AppleScript 返回了无法识别的窗口数据');
    return {
      ...stats,
      windowInspection: 'applescript',
      windowInspectionMessage: `AppleScript（${appName}）`,
      canMergeWindows: true,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(`窗口合并失败：${detail}`);
  }
}

export async function snapshotChromeSessions(): Promise<ChromeSession[]> {
  const sessions = buildChromeSessions(await listSystemProcesses());
  return Promise.all(sessions.map(async (session) => ({
    ...session,
    ...(await inspectSessionWindows(session)),
  })));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function closeSession(
  session: ChromeSession,
  options: {force?: boolean; allowProtected?: boolean} = {},
): Promise<CloseResult> {
  if (session.protected && !options.allowProtected) {
    throw new Error('正常 Chrome 已保护，当前版本不会自动关闭它。');
  }

  const chromeProcesses = [...session.processes].sort((left, right) => right.pid - left.pid);
  const attemptedPids = chromeProcesses.map((item) => item.pid);
  const controllerCanBeClosed = Boolean(session.controllerPid && !session.controllerShared);
  if (controllerCanBeClosed) attemptedPids.push(session.controllerPid!);

  const signaledPids: number[] = [];
  for (const pid of attemptedPids) {
    if (signal(pid, 'SIGTERM')) signaledPids.push(pid);
  }

  await sleep(250);
  const forceSignaledPids: number[] = [];
  if (options.force) {
    for (const pid of attemptedPids) {
      if (isAlive(pid) && signal(pid, 'SIGKILL')) forceSignaledPids.push(pid);
    }
  }

  return {
    sessionId: session.id,
    attemptedPids,
    signaledPids,
    forceSignaledPids,
    skippedController: Boolean(session.controllerPid && session.controllerShared),
  };
}

export async function closeAutomationSessions(
  sessions: ChromeSession[],
  options: {force?: boolean} = {},
): Promise<CloseResult[]> {
  const automationSessions = sessions.filter((session) => !session.protected);
  return Promise.all(automationSessions.map((session) => closeSession(session, options)));
}
