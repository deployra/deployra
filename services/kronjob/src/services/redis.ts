import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { CronJob, CronJobDeletedEvent } from '../types';

class RedisService {
  private client: Redis;
  private subscriber: Redis;
  private cronJobAddedCallback: ((job: CronJob) => void) | null = null;
  private cronJobUpdatedCallback: ((job: CronJob) => void) | null = null;
  private cronJobDeletedCallback: ((event: CronJobDeletedEvent) => void) | null = null;

  constructor() {
    const redisConfig = {
      host: config.redis.host,
      port: config.redis.port,
      username: config.redis.username || undefined,
      password: config.redis.password || undefined,
    };

    this.client = new Redis(redisConfig);
    this.subscriber = new Redis(redisConfig);

    this.client.on('error', (err) => {
      logger.error(`Redis client error: ${err}`);
    });

    this.subscriber.on('error', (err) => {
      logger.error(`Redis subscriber error: ${err}`);
    });

    this.setupSubscriptions();
  }

  private setupSubscriptions() {
    const channels = [
      config.redis.channels.cronJobAdded,
      config.redis.channels.cronJobUpdated,
      config.redis.channels.cronJobDeleted
    ];

    this.subscriber.subscribe(...channels, (err, count) => {
      if (err) {
        logger.error(`Failed to subscribe to Redis channels: ${err}`);
        return;
      }
      logger.info(`Subscribed to Redis channels: ${count}`);
    });

    this.subscriber.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        
        if (channel === config.redis.channels.cronJobAdded && this.cronJobAddedCallback) {
          logger.info(`Received cronJob added event: ${data.id}`);
          this.cronJobAddedCallback(data);
        } 
        else if (channel === config.redis.channels.cronJobUpdated && this.cronJobUpdatedCallback) {
          logger.info(`Received cronJob updated event: ${data.id}`);
          this.cronJobUpdatedCallback(data);
        } 
        else if (channel === config.redis.channels.cronJobDeleted && this.cronJobDeletedCallback) {
          logger.info(`Received cronJob deleted event: ${data.id}`);
          this.cronJobDeletedCallback(data);
        }
      } catch (err) {
        logger.error(`Error processing Redis message: ${err}`);
      }
    });
  }

  onCronJobAdded(callback: (job: CronJob) => void) {
    this.cronJobAddedCallback = callback;
  }

  onCronJobUpdated(callback: (job: CronJob) => void) {
    this.cronJobUpdatedCallback = callback;
  }

  onCronJobDeleted(callback: (event: CronJobDeletedEvent) => void) {
    this.cronJobDeletedCallback = callback;
  }

  async disconnect() {
    await this.subscriber.quit();
    await this.client.quit();
    logger.info('Redis connections closed');
  }
}

export const redisService = new RedisService();
