#!/usr/bin/env node
import process from 'node:process';
import readline from 'node:readline';
import {render} from 'ink';
import React from 'react';
import {App} from './ui.js';
import {closeAutomationSessions, closeSession, mergeSessionWindows, snapshotChromeSessions} from './processes.js';
import {formatTable} from './format.js';

function printHelp(): void {
  console.log(`Chrome Session TUI

用法：
  chrome-session                 打开交互式 TUI
  chrome-session list [--json]   列出当前 Chrome 主会话
  chrome-session inspect <pid>   查看一个会话的详细信息
  chrome-session merge <pid>     将可用会话的窗口合并到第一个窗口
  chrome-session close --all [--yes]  关闭全部自动化/Headless 会话（默认先确认）
  chrome-session close <pid>     关闭指定的自动化/Headless 会话

close 默认发送 SIGTERM；加 --force 才会在短暂等待后发送 SIGKILL。
正常 Chrome 会被保护，不会被这些命令关闭。
`);
}

async function confirmCloseAll(count: number): Promise<boolean> {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`确认关闭全部 ${count} 个自动化会话？输入 y 确认，其他任意键取消：`, resolve);
    });
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

function findSession(sessions: Awaited<ReturnType<typeof snapshotChromeSessions>>, value: string | undefined) {
  if (!value) return undefined;
  return sessions.find((session) => session.id === value || String(session.pid) === value);
}

async function runCli(args: string[]): Promise<void> {
  const normalizedArgs = args[0] === '--' ? args.slice(1) : args;
  const [command = 'tui', ...rest] = normalizedArgs;

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'tui') {
    render(React.createElement(App));
    return;
  }

  const sessions = await snapshotChromeSessions();

  if (command === 'list') {
    if (rest.includes('--json')) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      console.log(formatTable(sessions, process.stdout.columns ?? 100));
    }
    return;
  }

  if (command === 'inspect') {
    const session = findSession(sessions, rest[0]);
    if (!session) throw new Error(`找不到会话：${rest[0] ?? '(缺少 PID)'}`);
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  if (command === 'close') {
    const force = rest.includes('--force');
    if (rest.includes('--all')) {
      const targets = sessions.filter((session) => !session.protected);
      if (targets.length === 0) {
        console.log('没有可关闭的自动化会话。');
        return;
      }
      if (!rest.includes('--yes')) {
        if (!process.stdin.isTTY) {
          throw new Error(`将关闭 ${targets.length} 个自动化会话；非交互环境请加 --yes 确认。`);
        }
        const confirmed = await confirmCloseAll(targets.length);
        if (!confirmed) {
          console.log('已取消。');
          return;
        }
      }
      const results = await closeAutomationSessions(sessions, {force});
      console.log(`已处理 ${results.length} 个自动化/Headless 会话。`);
      return;
    }

    const target = rest.find((item) => !item.startsWith('--'));
    const session = findSession(sessions, target);
    if (!session) throw new Error(`找不到会话：${target ?? '(缺少 PID)'}`);
    const result = await closeSession(session, {force});
    console.log(`已处理 ${session.label} PID ${session.pid}；发送信号给 ${result.signaledPids.length} 个进程${force ? `，强制信号 ${result.forceSignaledPids.length} 个` : ''}。`);
    return;
  }

  if (command === 'merge') {
    const session = findSession(sessions, rest[0]);
    if (!session) throw new Error(`找不到会话：${rest[0] ?? '(缺少 PID)'}`);
    const stats = await mergeSessionWindows(session);
    console.log(`已将 PID ${session.pid} 的窗口合并到第一个窗口；现在有 ${stats.windowCount ?? 0} 个窗口、${stats.tabCount ?? 0} 个 Tab。`);
    return;
  }

  printHelp();
  throw new Error(`未知命令：${command}`);
}

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
