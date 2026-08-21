/**
 * Guards the boundary between the monorepo's OWN agent skills and what a
 * generated app ships.
 *
 * The framework keeps a set of workflow skills for working on WebJs itself
 * (`.claude/skills/*`, exposed cross-agent through `.agents/skills/*`
 * symlinks). Exactly ONE of them, `webjs`, is a teaching surface for app
 * authors and belongs in a generated app. Everything else is monorepo process:
 * how we file issues, how we sync docs, how we review our own PRs. Shipping
 * any of it would push our process onto a team that already has its own, and
 * `pr-review` is the live example, since how a team reviews pull requests is
 * theirs to decide.
 *
 * Nothing structural enforces that today: `create.js` copies the skill by a
 * hardcoded path, so a future change that copies the skills DIRECTORY instead
 * would ship the lot silently, and the app would look fine. These assertions
 * are that enforcement.
 *
 * They also pin the reverse direction: `webjs` must actually arrive, since the
 * skill is the only teaching surface that survives `npm run gallery:clear`, so
 * an app missing it has no reference at all once the gallery is stripped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scaffoldApp } from '../../packages/cli/lib/create.js';

// The one skill an app author needs. Anything else under .agents/skills/ in a
// generated app is monorepo process that leaked.
const APP_SKILLS = ['webjs'];

for (const template of ['full-stack', 'api']) {
  test(`${template} scaffold ships the webjs skill and no monorepo process skills`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'webjs-scaffold-skills-'));
    try {
      await scaffoldApp('demo', cwd, { template, install: false });
      const skillsDir = join(cwd, 'demo', '.agents', 'skills');
      assert.ok(existsSync(skillsDir), '.agents/skills/ must exist in a generated app');

      const shipped = readdirSync(skillsDir).sort();
      assert.deepEqual(shipped, APP_SKILLS,
        `a generated app must ship exactly ${APP_SKILLS.join(', ')}; found ${shipped.join(', ') || '(none)'}`);

      // The skill has to be the real thing, not an empty directory.
      assert.ok(existsSync(join(skillsDir, 'webjs', 'SKILL.md')), 'the `webjs` skill ships its SKILL.md');
      assert.ok(existsSync(join(skillsDir, 'webjs', 'references')), 'the `webjs` skill ships its references/');

      // Named explicitly so the failure message says WHY, rather than only
      // that a directory listing changed.
      for (const monorepoOnly of ['pr-review', 'webjs-start-work', 'webjs-file-issue', 'webjs-doc-sync']) {
        assert.ok(!existsSync(join(skillsDir, monorepoOnly)),
          `${monorepoOnly} is a monorepo workflow skill and must not ship to a generated app`);
      }

      // And no per-agent rule files or vendor tool config at all. AGENTS.md
      // plus .agents/ is the whole agent surface, so the app does not carry
      // one team's tool choices into another's repo. The monorepo keeps its
      // own .claude/; none of it is scaffolded.
      const appDir = join(cwd, 'demo');
      for (const perAgent of [
        'CLAUDE.md', 'CONVENTIONS.md', '.claude', '.claude.json',
        '.cursorrules', '.cursor', 'GEMINI.md', '.gemini', '.opencode',
        '.github/copilot-instructions.md', '.windsurfrules',
      ]) {
        assert.ok(!existsSync(join(appDir, perAgent)),
          `${perAgent} is per-agent config and must not ship to a generated app`);
      }
      // AGENTS.md is what makes the single surface reachable: nothing reads
      // .agents/ on its own, so it must route there.
      const agentsMd = await readFile(join(appDir, 'AGENTS.md'), 'utf8');
      assert.match(agentsMd, /\.agents\/skills\/webjs/, 'AGENTS.md routes to the skill');
      assert.match(agentsMd, /\.agents\/rules\/workflow\.md/, 'AGENTS.md routes to the workflow rules');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test('the generated agent rules do not mandate a review process', async () => {
  // WebJs is opinionated about the code (conventions, `webjs check`, the test
  // layers) and deliberately silent on how a team reviews a PR. The scaffold
  // used to ship a mandatory multi-round self-review loop plus a PR-template
  // checkbox pointing at a CONVENTIONS.md section that did not exist.
  const cwd = await mkdtemp(join(tmpdir(), 'webjs-scaffold-skills-'));
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack', install: false });
    for (const rel of ['.agents/rules/workflow.md', '.github/pull_request_template.md']) {
      const p = join(cwd, 'demo', rel);
      if (!existsSync(p)) continue;
      const src = await readFile(p, 'utf8');
      assert.doesNotMatch(src, /self-review/i, `${rel} must not mandate a self-review loop`);
      assert.doesNotMatch(src, /fresh-context review/i, `${rel} must not mandate review rounds`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
