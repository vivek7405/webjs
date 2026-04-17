import { html } from 'webjs';

export const metadata = { title: 'Background Jobs — webjs' };

export default function Jobs() {
  return html`
    <h1>Background Jobs</h1>
    <p>webjs includes a lightweight job queue that follows the <strong>convention over configuration</strong> philosophy: an in-memory queue for development, automatic switch to Redis-backed queues in production when <code>REDIS_URL</code> is set. No config files, no adapter setup.</p>

    <h2>Zero-Config Convention</h2>
    <pre># Development — nothing to configure
# webjs uses memoryQueue automatically (jobs run in-process)

# Production — set one env var
REDIS_URL=redis://localhost:6379</pre>

    <p>In development, <code>memoryQueue</code> runs jobs in the same process with no persistence — fast iteration, instant feedback. In production, <code>redisQueue</code> provides durable, distributed job processing across multiple worker instances.</p>

    <h2>Queues</h2>
    <h3>memoryQueue (default)</h3>
    <p>Jobs are stored in an in-process array and executed immediately. No persistence — if the process restarts, pending jobs are lost. This is intentional for development: fast and zero-dependency.</p>

    <h3>redisQueue (production)</h3>
    <p>Jobs are stored in Redis lists with atomic dequeue. Durable across restarts, distributable across multiple worker processes. Activated automatically when <code>REDIS_URL</code> is present.</p>

    <h2>API</h2>
    <h3>defineJob(name, handler)</h3>
    <p>Defines a named job with its processing function. Jobs are defined in <code>.server.js</code> files since they run server-side only:</p>

    <pre>// jobs/send-email.server.js
import { defineJob } from '@webjs/server';
import { sendEmail } from '../lib/mailer.server.js';

export const sendEmailJob = defineJob('send-email', async (payload) => {
  await sendEmail({
    to: payload.to,
    subject: payload.subject,
    html: payload.body,
  });
});</pre>

    <h3>enqueue(job, payload, options?)</h3>
    <p>Adds a job to the queue. Returns immediately — the job is processed asynchronously by a worker.</p>

    <pre>import { enqueue } from '@webjs/server';
import { sendEmailJob } from '../jobs/send-email.server.js';

await enqueue(sendEmailJob, {
  to: 'ada@example.com',
  subject: 'Welcome!',
  body: '&lt;h1&gt;Welcome to the app&lt;/h1&gt;',
});</pre>

    <p>Options:</p>
    <pre>await enqueue(sendEmailJob, payload, {
  delay: 60,       // delay execution by 60 seconds
  retries: 3,      // retry up to 3 times on failure
  backoff: 'exponential', // 'fixed' or 'exponential' retry backoff
});</pre>

    <h2>Example: Welcome Email on Signup</h2>
    <pre>// jobs/welcome-email.server.js
import { defineJob } from '@webjs/server';
import { sendEmail } from '../lib/mailer.server.js';

export const welcomeEmailJob = defineJob('welcome-email', async ({ userId }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return; // user deleted before job ran

  await sendEmail({
    to: user.email,
    subject: \`Welcome, \${user.name}!\`,
    html: \`&lt;p&gt;Thanks for signing up. Your account is ready.&lt;/p&gt;\`,
  });
});

// app/api/signup/route.server.js
import { enqueue } from '@webjs/server';
import { welcomeEmailJob } from '../../../jobs/welcome-email.server.js';
import { prisma } from '../../lib/db.server.js';

export async function POST(req) {
  const { name, email, password } = await req.json();

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password) },
  });

  // Enqueue the email — don't block the response
  await enqueue(welcomeEmailJob, { userId: user.id });

  return Response.json({ id: user.id }, { status: 201 });
}</pre>

    <h2>Example: Scheduled Report</h2>
    <pre>// jobs/daily-report.server.js
import { defineJob } from '@webjs/server';

export const dailyReportJob = defineJob('daily-report', async () => {
  const stats = await prisma.order.aggregate({
    _sum: { total: true },
    _count: { id: true },
    where: {
      createdAt: { gte: new Date(Date.now() - 86400000) },
    },
  });

  await sendEmail({
    to: 'team@example.com',
    subject: 'Daily Sales Report',
    html: \`&lt;p&gt;Orders: \${stats._count.id}, Revenue: $\${stats._sum.total}&lt;/p&gt;\`,
  });
});</pre>

    <h2>Running Workers</h2>
    <p>In development, the memory queue processes jobs in the same process as the dev server — no extra step needed.</p>

    <p>In production, start a dedicated worker process alongside your web server:</p>

    <pre># Start the web server
npx webjs start --port 3000

# In another process — start the job worker
npx webjs worker</pre>

    <p>The worker connects to the same Redis instance and processes jobs from the queue. You can run multiple workers for horizontal scaling.</p>

    <h2>Error Handling</h2>
    <p>If a job handler throws, the job is marked as failed. With retries configured, it is re-enqueued with the specified backoff strategy. After all retries are exhausted, the job moves to a dead-letter queue for inspection.</p>

    <pre>// Check failed jobs
import { getDeadLetterJobs } from '@webjs/server';

const failed = await getDeadLetterJobs({ limit: 10 });
// [{ id, name, payload, error, failedAt }, ...]</pre>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/cache">Cache Store</a> — the backing store that powers job queues</li>
      <li><a href="/docs/pubsub">Pub/Sub</a> — real-time event broadcasting across instances</li>
      <li><a href="/docs/server-actions">Server Actions</a> — enqueue jobs from server action handlers</li>
    </ul>
  `;
}
