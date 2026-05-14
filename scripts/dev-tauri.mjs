import { spawn } from 'child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function terminateChildren() {
  for (const child of children) {
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  }
}

function runScript(scriptName) {
  const child = spawn(npmCommand, ['run', scriptName], {
    stdio: 'inherit'
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

server.on('exit', code => exitWith(code ?? 0));
web.on('exit', code => exitWith(code ?? 0));

process.on('SIGINT', () => exitWith(0));
process.on('SIGTERM', () => exitWith(0));
