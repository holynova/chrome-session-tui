export type SessionKind = 'normal' | 'automation' | 'headless' | 'unknown';
export type WindowInspectionSource = 'cdp' | 'applescript' | 'unavailable' | 'error';

export interface WindowStats {
  windowCount: number | null;
  tabCount: number | null;
  windowInspection: WindowInspectionSource;
  windowInspectionMessage?: string;
  canMergeWindows: boolean;
}

export interface SystemProcess {
  pid: number;
  ppid: number;
  user: string;
  elapsedSeconds: number;
  rssKb: number;
  cpuPercent: number;
  command: string;
  isChrome: boolean;
  isMainBrowser: boolean;
}

export interface ChromeSession {
  id: string;
  pid: number;
  ppid: number;
  kind: SessionKind;
  label: string;
  source: string;
  reason: string;
  profile?: string;
  userDataDir?: string;
  controllerPid?: number;
  controllerCommand?: string;
  controllerShared: boolean;
  processCount: number;
  childCount: number;
  windowCount: WindowStats['windowCount'];
  tabCount: WindowStats['tabCount'];
  windowInspection: WindowStats['windowInspection'];
  windowInspectionMessage?: WindowStats['windowInspectionMessage'];
  canMergeWindows: WindowStats['canMergeWindows'];
  rssMb: number;
  cpuPercent: number;
  uptimeSeconds: number;
  startedAt: string;
  protected: boolean;
  command: string;
  processes: SystemProcess[];
}

export interface CloseResult {
  sessionId: string;
  attemptedPids: number[];
  signaledPids: number[];
  forceSignaledPids: number[];
  skippedController: boolean;
}
