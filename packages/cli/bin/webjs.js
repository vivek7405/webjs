#!/usr/bin/env node
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '@webjs/server';

const [cmd, ...rest] = process.argv.slice(2);

const USAGE = `webjs — commands:
  webjs dev [--port 3000]        Start dev server with live reload
  webjs start [--port 3000]      Start production server
  webjs db generate              Run \`prisma generate\`
  webjs db migrate [name]        Run \`prisma migrate dev\`
  webjs db studio                Run \`prisma studio\`
  webjs help                     Show this help`;

/** @param {string[]} args */
function flag(args, name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  return args[i + 1];
}

async function main() {
  switch (cmd) {
    case 'dev': {
      const port = Number(flag(rest, '--port', process.env.PORT || 3000));
      await startServer({ appDir: process.cwd(), port, dev: true });
      break;
    }
    case 'start': {
      const port = Number(flag(rest, '--port', process.env.PORT || 3000));
      await startServer({ appDir: process.cwd(), port, dev: false });
      break;
    }
    case 'db': {
      const sub = rest[0];
      const args = rest.slice(1);
      const map = { generate: ['generate'], migrate: ['migrate', 'dev', ...args], studio: ['studio'] };
      const prismaArgs = map[sub];
      if (!prismaArgs) { console.error('Unknown db subcommand.\n' + USAGE); process.exit(1); }
      const child = spawn('npx', ['prisma', ...prismaArgs], { stdio: 'inherit', cwd: process.cwd() });
      child.on('exit', (code) => process.exit(code ?? 0));
      break;
    }
    case 'help':
    case undefined:
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n` + USAGE);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
