import { KubeStratorService } from "./services/kubestrator";

async function main() {
  try {
    const service = new KubeStratorService();
    await service.start();
  } catch (error) {
    console.error('Failed to start KubeStrator:', error);
    process.exit(1);
  }
}

main();
