import { ECR } from 'aws-sdk';
import { config } from '../config';
import { logger } from '../utils/logger';

export class ECRService {
  private ecr: ECR;

  constructor() {
    if (!config.aws.accessKeyId || !config.aws.secretAccessKey) {
      logger.warn('AWS credentials are missing or empty. ECR operations will likely fail.');
    }

    if (!config.aws.region) {
      logger.warn('AWS region is not specified. Using default region.');
    }

    this.ecr = new ECR({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId || '',
        secretAccessKey: config.aws.secretAccessKey || '',
      },
    });
  }

  /**
   * Get ECR authentication token
   * @returns {Promise<{token: string, proxyEndpoint: string}>}
   */
  async getAuthorizationToken(): Promise<{ token: string; proxyEndpoint: string }> {
    try {
      logger.info('Getting ECR authorization token');
      const data = await this.ecr.getAuthorizationToken().promise();
      
      if (!data.authorizationData || data.authorizationData.length === 0) {
        throw new Error('No authorization data returned from ECR');
      }
      
      const authData = data.authorizationData[0];
      
      if (!authData.authorizationToken || !authData.proxyEndpoint) {
        throw new Error('Invalid authorization data returned from ECR');
      }
      
      // Decode the base64 encoded token
      const decodedToken = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8');
      
      // The token is in the format "username:password"
      const [, password] = decodedToken.split(':');
      
      return {
        token: password,
        proxyEndpoint: authData.proxyEndpoint,
      };
    } catch (error) {
      logger.error(`Error getting ECR authorization token: ${error}`);
      throw error;
    }
  }
}
