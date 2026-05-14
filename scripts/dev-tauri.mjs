import { spawn } from 'child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function terminateChildren() {
  for (const child of children) {
    if (child && !child.killed) {
      child.kill();
    }
  }
}

function runScript(scriptName) {
  const child = spawn(npmCommand, ['run', scriptName], {
    stdio: 'inherit',
    shell: true
  });
  children.push(child);
  return child;
}

const server = runScript('server');
const web = runScript('dev');

let exiting = false;
function exitWith(code) {
  if (exiting) return;
  exiting = true;
  terminateChildren();
  process.exit(code);
}

server.on('exit', code => {
  if ((code ?? 0) !== 0) console.error(`Backend dev server exited with code ${code}`);
  exitWith(code ?? 0);
});
web.on('exit', code => {
  if ((code ?? 0) !== 0) console.error(`Frontend dev server exited with code ${code}`);
  exitWith(code ?? 0);
});

process.on('SIGINT', () => exitWith(0));
process.on('SIGTERM', () => exitWith(0));
