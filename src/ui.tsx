import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {closeAutomationSessions, closeSession, mergeSessionWindows, snapshotChromeSessions} from './processes.js';
import {formatDuration, formatSessionPrimaryRow, formatSessionSecondaryRow, formatTableHeader, formatWindowSummary, truncateToWidth} from './format.js';
import type {ChromeSession} from './types.js';

type Confirmation = {kind: 'selected' | 'all' | 'merge'; force: boolean};

function colorFor(session: ChromeSession): string {
  if (session.kind === 'normal') return 'green';
  if (session.kind === 'headless') return 'magenta';
  if (session.kind === 'automation') return 'yellow';
  return 'gray';
}

function shortPath(value: string | undefined): string {
  if (!value) return '默认配置';
  return value.replace(/^\/Users\/[^/]+/, '~');
}

export function App(): React.ReactElement {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const [sessions, setSessions] = useState<ChromeSession[]>([]);
  const [selected, setSelected] = useState(0);
  const [details, setDetails] = useState(false);
  const [message, setMessage] = useState('正在扫描 Chrome…');
  const [refreshing, setRefreshing] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | undefined>();
  const refreshInFlight = useRef(false);
  const contentWidth = Math.max(68, (stdout.columns ?? 100) - 2);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      setSessions(await snapshotChromeSessions());
      setMessage(`最近刷新：${new Date().toLocaleTimeString('zh-CN', {hour12: false})}`);
    } catch (error) {
      setMessage(`扫描失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRefreshing(false);
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, sessions.length - 1)));
  }, [sessions.length]);

  const selectedSession = sessions[selected];
  const automationCount = useMemo(() => sessions.filter((session) => !session.protected).length, [sessions]);

  const executeClose = useCallback(async (action: Confirmation) => {
    try {
      if (action.kind === 'all') {
        const results = await closeAutomationSessions(sessions, {force: action.force});
        const signaled = results.reduce((sum, result) => sum + result.signaledPids.length + result.forceSignaledPids.length, 0);
        setMessage(`已向 ${results.length} 个自动化会话发送关闭信号（${signaled} 个进程）。`);
      } else if (action.kind === 'merge' && selectedSession) {
        const stats = await mergeSessionWindows(selectedSession);
        setMessage(`已将 PID ${selectedSession.pid} 的窗口合并到第一个窗口（${stats.tabCount ?? 0} 个 Tab）。`);
      } else if (selectedSession) {
        const result = await closeSession(selectedSession, {force: action.force});
        setMessage(`已处理 PID ${selectedSession.pid}（${result.signaledPids.length} 个进程）。`);
      }
      await refresh();
    } catch (error) {
      setMessage(`关闭失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [refresh, selectedSession, sessions]);

  useInput((input, key) => {
    if (confirmation) {
      if (input.toLowerCase() === 'y') {
        const action = confirmation;
        setConfirmation(undefined);
        void executeClose(action);
      } else if (input.toLowerCase() === 'n' || key.escape) {
        setConfirmation(undefined);
        setMessage('已取消。');
      }
      return;
    }

    if (input === 'q' || key.escape) {
      exit();
    } else if (key.upArrow || input === 'k') {
      setSelected((current) => Math.max(0, current - 1));
    } else if (key.downArrow || input === 'j') {
      setSelected((current) => Math.min(Math.max(0, sessions.length - 1), current + 1));
    } else if (input === 'r') {
      void refresh();
    } else if (input === 'd' || key.return) {
      setDetails((current) => !current);
    } else if (input === 'x' && selectedSession) {
      if (selectedSession.protected) {
        setMessage('正常 Chrome 已保护，当前版本不会自动关闭它。');
      } else {
        setConfirmation({kind: 'selected', force: false});
      }
    } else if (input === 'X' && selectedSession && !selectedSession.protected) {
      setConfirmation({kind: 'selected', force: true});
    } else if (input === 'm' && selectedSession) {
      if (!selectedSession.canMergeWindows) {
        setMessage(selectedSession.windowInspectionMessage ?? '当前会话不支持窗口合并。');
      } else if ((selectedSession.windowCount ?? 0) < 2) {
        setMessage('当前会话只有一个窗口，无需合并。');
      } else {
        setConfirmation({kind: 'merge', force: false});
      }
    } else if (input === 'a' && automationCount > 0) {
      setConfirmation({kind: 'all', force: false});
    } else if (input === 'A' && automationCount > 0) {
      setConfirmation({kind: 'all', force: true});
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">Chrome Session TUI</Text>
        <Text>{refreshing ? '扫描中…' : `${sessions.length} 个主会话`}</Text>
      </Box>
      <Text dimColor>只显示 Chrome 主会话；Renderer/GPU/Utility 子进程会合并到所属会话。</Text>
      <Box marginTop={1} flexDirection="column">
        {sessions.length === 0 ? (
          <Text color="gray">没有发现 Chrome 主会话。</Text>
        ) : (
          <>
            <Text dimColor>{formatTableHeader(contentWidth)}</Text>
            {sessions.map((session, index) => (
              <Box key={session.id} flexDirection="column">
                <Text color={index === selected ? colorFor(session) : undefined} bold={index === selected}>
                  {formatSessionPrimaryRow(session, index === selected, contentWidth)}
                </Text>
                <Text dimColor>{formatSessionSecondaryRow(session, contentWidth)}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>
      {selectedSession && details && (
        <Box borderStyle="round" borderColor={colorFor(selectedSession)} marginTop={1} paddingX={1} flexDirection="column" width={contentWidth}>
          <Text bold color={colorFor(selectedSession)}>{selectedSession.label} · PID {selectedSession.pid}</Text>
          <Text>状态：{selectedSession.protected ? '正常浏览器（受保护）' : '可关闭的自动化会话'}</Text>
          <Text>来源：{selectedSession.source}；原因：{selectedSession.reason}</Text>
          <Text>配置：{shortPath(selectedSession.userDataDir)}{selectedSession.profile ? ` / ${selectedSession.profile}` : ''}</Text>
          <Text>运行：{formatDuration(selectedSession.uptimeSeconds)}；内存：{selectedSession.rssMb.toFixed(1)} MB；CPU：{selectedSession.cpuPercent.toFixed(1)}%</Text>
          <Text>进程：{selectedSession.processCount} 个；父 PID：{selectedSession.ppid}{selectedSession.controllerPid ? `；控制器 PID：${selectedSession.controllerPid}` : ''}</Text>
          <Text>窗口与 Tab：{formatWindowSummary(selectedSession)}；读取：{selectedSession.windowInspectionMessage ?? '未知'}</Text>
          <Text>窗口操作：{selectedSession.canMergeWindows ? 'm 合并到第一个窗口' : '当前会话不可合并'}</Text>
          {selectedSession.controllerShared && <Text color="yellow">控制器被多个会话共享，关闭时不会杀掉控制器。</Text>}
          <Text dimColor>命令：{truncateToWidth(selectedSession.command, Math.max(0, contentWidth - 4))}</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {confirmation ? (
          <Text color="yellow" bold>
            {confirmation.kind === 'all' ? `确认关闭全部 ${automationCount} 个自动化会话` : confirmation.kind === 'merge' ? `确认把 PID ${selectedSession?.pid ?? '-'} 的 ${selectedSession?.windowCount ?? 0} 个窗口合并到第一个窗口` : `确认关闭 PID ${selectedSession?.pid ?? '-'} 会话`}
            {confirmation.force ? '（强制）' : ''}？按 y 确认，n 取消
          </Text>
        ) : (
          <Text color="gray">{message}</Text>
        )}
        <Text dimColor>↑/↓ j/k 选择 · Enter/d 详情 · m 合并窗口 · x 关闭 · X 强制 · a 全部自动化 · A 全部强制 · r 刷新 · q 退出</Text>
      </Box>
    </Box>
  );
}
