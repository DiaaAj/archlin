#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ToyAppStack } from '../lib/stack';

const app = new cdk.App();
new ToyAppStack(app, 'ToyAppStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '123456789012', // Replace with your AWS account ID if needed
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1', // Replace with your preferred region
  },
});
