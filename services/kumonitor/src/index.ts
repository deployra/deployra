import { kuMonitorService } from './services/kumonitor';
import { logger } from './utils/logger';

async function main() {
  try {
    await kuMonitorService.start();
  } catch (error) {
    logger.error('Failed to start KuMonitor service:', error);
    process.exit(1);
  }
}

main();
