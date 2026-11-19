import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const MAX_STDERR = 4096;

// Runs the engine once and streams its stdout to `res`, one line at a time.
// The process is killed if the client goes away or the run exceeds
// `timeoutMs`. `onEnd` is called exactly once, after the response has ended.
// Returns { pid, kill }.
export function startRun({ bin, args, res, timeoutMs, onEnd, log }) {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let ended = false;
  let timedOut = false;
  let sawError = false;
  let stderr = '';

  const writeLine = (line) => {
    if (!res.writableEnded && !res.destroyed) res.write(line + '\n');
  };
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  const finish = (extraError) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    if (extraError && !sawError && !timedOut) writeLine(JSON.stringify({ type: 'error', message: extraError }));
    if (stderr) log.warn(`engine stderr (pid ${child.pid}): ${stderr.trim()}`);
    if (!res.writableEnded) res.end();
    onEnd();
  };

  // readline only ever hands over whole lines, so a line the server adds
  // (timeout, crash) can never land in the middle of an engine line.
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (line.startsWith('{"type":"error"')) sawError = true;
    writeLine(line);
  });

  child.stderr.on('data', (chunk) => {
    if (stderr.length < MAX_STDERR) stderr += chunk.toString().slice(0, MAX_STDERR - stderr.length);
  });

  const timer = setTimeout(() => {
    timedOut = true;
    writeLine(JSON.stringify({ type: 'error', message: 'run timed out' }));
    kill();
  }, timeoutMs);

  // The client disconnected or aborted: stop the simulation.
  res.on('close', () => {
    if (!ended) kill();
  });

  child.on('error', (err) => {
    log.error(`could not start engine ${bin}: ${err.message}`);
    finish('the simulation engine could not be started');
  });

  // Wait for the process to exit AND for every line to be read.
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  const drained = new Promise((resolve) => lines.on('close', resolve));
  Promise.all([exited, drained]).then(([{ code, signal }]) => {
    finish(code === 0 ? null : `engine stopped unexpectedly (${code ?? signal})`);
  });

  return { pid: child.pid, kill };
}
