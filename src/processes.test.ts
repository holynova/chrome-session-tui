import {describe, expect, it} from 'vitest';
import {buildChromeSessions, parseElapsed, parsePsOutput} from './processes.js';

describe('Chrome process parsing', () => {
  it('parses macOS elapsed time formats', () => {
    expect(parseElapsed('01:02')).toBe(62);
    expect(parseElapsed('1:02:03')).toBe(3723);
    expect(parseElapsed('2-03:04:05')).toBe(183845);
  });

  it('groups child processes and distinguishes automation from normal Chrome', () => {
    const output = [
      ' 100     1 sym  00:30    900  0.1 /opt/node/bin/node /tmp/playwright-cliDaemon.js',
      ' 101   100 sym  00:28  12000  1.2 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --user-data-dir=/var/folders/xx/temp-profile --remote-debugging-pipe',
      ' 102   101 sym  00:27   5000  0.2 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer',
      ' 200     1 sym  02:00  25000  0.4 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --profile-directory=Default',
      ' 201   200 sym  01:59   8000  0.0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer',
    ].join('\n');

    const sessions = buildChromeSessions(parsePsOutput(output), Date.parse('2026-08-01T00:00:00Z'));

    expect(sessions).toHaveLength(2);
    expect(sessions[0].pid).toBe(101);
    expect(sessions[0].kind).toBe('headless');
    expect(sessions[0].processCount).toBe(2);
    expect(sessions[0].protected).toBe(false);
    expect(sessions[1].pid).toBe(200);
    expect(sessions[1].kind).toBe('normal');
    expect(sessions[1].protected).toBe(true);
  });
});
