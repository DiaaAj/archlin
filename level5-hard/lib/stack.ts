import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';

export class ToyAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Replace these with your actual domain information
    // Using a non-reserved domain name
    const domainName = 'mydemoapp.com';
    const appSubdomain = 'app';
    const apiSubdomain = 'api';
    const fullDomainName = `${appSubdomain}.${domainName}`;
    const apiDomainName = `${apiSubdomain}.${domainName}`;

    // Create KMS key for DynamoDB encryption
    const encryptionKey = new kms.Key(this, 'TableEncryptionKey', {
      enableKeyRotation: true,
      description: 'KMS key for encrypting DynamoDB submissions table',
      alias: 'alias/submissions-table-key',
    });

    // Create DynamoDB table
    const submissionsTable = new dynamodb.Table(this, 'SubmissionsTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Define additional fields through non key attributes
      // Cannot be enforced at infrastructure level but documenting as comment
      // Fields: id (partition key), name, email, message, timestamp
    });

    // Create Lambda function for API
    const apiFunction = new lambda.Function(this, 'SubmitHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { DynamoDB } = require('aws-sdk');
        const { v4: uuidv4 } = require('uuid');
        const dynamo = new DynamoDB.DocumentClient();
        
        exports.handler = async (event) => {
          try {
            // Parse request body
            const body = JSON.parse(event.body);
            
            // Validate input
            if (!body.name || !body.email || !body.message) {
              return {
                statusCode: 400,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*', // Configure appropriate CORS
                },
                body: JSON.stringify({ error: 'Missing required fields: name, email, message' })
              };
            }
            
            // Prepare item for DynamoDB
            const item = {
              id: uuidv4(),
              name: body.name,
              email: body.email,
              message: body.message,
              timestamp: new Date().toISOString()
            };
            
            // Store in DynamoDB
            await dynamo.put({
              TableName: process.env.SUBMISSIONS_TABLE_NAME,
              Item: item
            }).promise();
            
            // Return success response
            return {
              statusCode: 201,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // Configure appropriate CORS
              },
              body: JSON.stringify({ success: true, id: item.id })
            };
          } catch (error) {
            console.error('Error:', error);
            
            // Return error response
            return {
              statusCode: 500,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // Configure appropriate CORS
              },
              body: JSON.stringify({ error: 'An error occurred processing the submission' })
            };
          }
        };
      `),
      environment: {
        SUBMISSIONS_TABLE_NAME: submissionsTable.tableName,
      },
    });

    // Grant Lambda function permissions to write to DynamoDB table
    submissionsTable.grantWriteData(apiFunction);

    // Create a new Hosted Zone instead of looking up one
    // For testing purposes, in production you would use fromLookup
    const hostedZone = new route53.HostedZone(this, 'HostedZone', {
      zoneName: domainName
    });

    // SSL Certificate
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: fullDomainName,
      subjectAlternativeNames: [apiDomainName],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const apiCertificate = new acm.Certificate(this, 'ApiCertificate', {
      domainName: apiDomainName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'SubmitApi', {
      restApiName: 'Submission Service API',
      description: 'API for handling form submissions',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // Configure appropriately for production
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'prod',
      },
      domainName: {
        domainName: apiDomainName,
        certificate: apiCertificate,
      },
    });

    // Add resource and method to API Gateway
    const submitResource = api.root.addResource('submit');
    submitResource.addMethod('POST', new apigateway.LambdaIntegration(apiFunction));

    // Create DNS record for API Gateway
    new route53.ARecord(this, 'ApiDnsRecord', {
      zone: hostedZone,
      recordName: apiSubdomain,
      target: route53.RecordTarget.fromAlias(new targets.ApiGatewayDomain(api.domainName!)),
    });

    // S3 bucket for frontend assets
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
      autoDeleteObjects: true, // Set to false for production
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // CloudFront Origin Access Identity for S3
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'CloudFront access to S3 bucket',
    });

    // Grant CloudFront OAI read access to the bucket
    frontendBucket.grantRead(originAccessIdentity);

    // CloudFront distribution for the frontend
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3BucketOrigin(frontendBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      domainNames: [fullDomainName],
      certificate: certificate,
    });

    // Create DNS record for CloudFront
    new route53.ARecord(this, 'FrontendDnsRecord', {
      zone: hostedZone,
      recordName: appSubdomain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // Output values
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'Name of the S3 bucket hosting the frontend',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'SubmissionsTableName', {
      value: submissionsTable.tableName,
      description: 'Name of the DynamoDB table for submissions',
    });

    new cdk.CfnOutput(this, 'FullDomainName', {
      value: fullDomainName,
      description: 'Full domain name for the application',
    });

    new cdk.CfnOutput(this, 'ApiDomainName', {
      value: apiDomainName,
      description: 'Domain name for the API',
    });

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: hostedZone.hostedZoneId,
      description: 'Hosted zone ID',
    });
  }
}
