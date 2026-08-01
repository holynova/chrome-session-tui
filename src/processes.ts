import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import process from 'node:process';
import type {ChromeSession, CloseResult, SessionKind, SystemProcess} from './types.js';

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

export async function snapshotChromeSessions(): Promise<ChromeSession[]> {
  return buildChromeSessions(await listSystemProcesses());
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
