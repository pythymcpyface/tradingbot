import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lightsail from 'aws-cdk-lib/aws-lightsail';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class LightsailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. ECR Repository
    const repository = new ecr.Repository(this, 'TradingBotRepo', {
      repositoryName: 'trading-bot',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For easy cleanup during dev
      lifecycleRules: [
        { maxImageCount: 5 } // Keep storage costs low
      ]
    });

    // 2. Secrets Manager Secret for Binance Keys
    const binanceSecret = new secretsmanager.Secret(this, 'BinanceKeys', {
      secretName: 'tradingbot/binance-keys',
      description: 'Binance API Key and Secret',
      // Create a skeleton secret; user must update values in AWS Console/CLI
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          BINANCE_API_KEY: 'CHANGE_ME',
          BINANCE_API_SECRET: 'CHANGE_ME'
        }),
        generateStringKey: 'dummy',
      }
    });

    // 3. Lightsail Instance
    // We assume the user has a default key pair or we use a common name.
    // In Lightsail, 'id_rsa' is often the default if created via CLI, or 'LightsailDefaultKeyPair'.
    // We'll use 'id_rsa' as a placeholder, user can override or ensure it exists.
    
    const instance = new lightsail.CfnInstance(this, 'TradingBotInstance', {
      instanceName: 'TradingBot-Instance',
      availabilityZone: 'ap-southeast-1a', // Hardcoded for simplicity based on plan
      blueprintId: 'ubuntu_20_04',
      bundleId: 'nano_2_0', // 512MB RAM, 1 vCPU
      keyPairName: 'id_rsa', // Ensure this key exists in Lightsail console!
    });

    // Outputs
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI'
    });

    new cdk.CfnOutput(this, 'InstanceName', {
      value: instance.instanceName,
      description: 'Lightsail Instance Name'
    });
    
    new cdk.CfnOutput(this, 'SecretArn', {
      value: binanceSecret.secretArn,
      description: 'Secret ARN for Binance Keys'
    });
  }
}
