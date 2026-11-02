// 서버 PC 스피커로 미디어 재생 (Windows: PowerShell MediaPlayer / macOS: afplay / Linux: ffplay·mpg123)
const { spawn } = require('node:child_process');
const path = require('node:path');

let current = null;

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']);

function stop() {
  if (current && !current.killed) {
    try { current.kill(); } catch { /* ignore */ }
  }
  current = null;
}

function play(file, volume = 70) {
  stop();
  const vol = Math.max(0, Math.min(100, Number(volume) || 70)) / 100;
  const ext = path.extname(file).toLowerCase();
  let cmd;
  let args;
  if (process.platform === 'win32') {
    if (VIDEO_EXT.has(ext)) {
      // 동영상은 기본 플레이어 앱으로 열기
      cmd = 'cmd';
      args = ['/c', 'start', '""', file];
    } else {
      const f = file.replace(/'/g, "''");
      const ps = `Add-Type -AssemblyName presentationCore;
$p = New-Object System.Windows.Media.MediaPlayer;
$p.Open([uri]'${f}'); $p.Volume = ${vol};
$i = 0; while (-not $p.NaturalDuration.HasTimeSpan -and $i -lt 50) { Start-Sleep -Milliseconds 100; $i++ };
$p.Play();
if ($p.NaturalDuration.HasTimeSpan) { Start-Sleep -Seconds ([math]::Ceiling($p.NaturalDuration.TimeSpan.TotalSeconds) + 1) } else { Start-Sleep -Seconds 300 };
$p.Close()`;
      cmd = 'powershell';
      args = ['-NoProfile', '-NonInteractive', '-Command', ps];
    }
  } else if (process.platform === 'darwin') {
    if (VIDEO_EXT.has(ext)) {
      cmd = 'open';
      args = [file];
    } else {
      cmd = 'afplay';
      args = ['-v', String(vol), file];
    }
  } else {
    cmd = 'ffplay';
    args = ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(Math.round(vol * 100)), file];
  }
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
      current = p;
      p.on('error', (e) => {
        console.warn('[player] 재생 실패:', e.message);
        if (current === p) current = null;
        resolve({ ok: false, error: e.message });
      });
      p.on('spawn', () => resolve({ ok: true }));
      p.on('exit', () => { if (current === p) current = null; });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

module.exports = { play, stop };
