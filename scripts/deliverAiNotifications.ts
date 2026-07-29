import '../server/loadEnv';
import { initDB } from '../server/db';
import { deliverAiNotificationBatch } from '../server/aiNotificationDelivery';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    if (!(process.env.DATABASE_URL || '').trim()) {
      throw new Error('DATABASE_URL is required for production AI notification delivery.');
    }
    if (!(process.env.SMTP_HOST || '').trim()) {
      throw new Error('SMTP_HOST is required for production AI notification delivery.');
    }
  }

  await initDB();
  const limit = Math.max(1, Math.min(100, Number(process.argv[2]) || 25));
  const result = await deliverAiNotificationBatch({ limit });
  console.log(JSON.stringify({ operation: 'ai-notification-delivery', ...result }));
  if (result.failed > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(
    '[ai-notification-delivery] worker failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
}
