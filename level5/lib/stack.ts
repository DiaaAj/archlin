import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deployment from 'aws-cdk-lib/aws-s3-deployment';

export class ToyAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // KMS Key for encrypting DynamoDB data
    const encryptionKey = new kms.Key(this, 'SubmissionsEncryptionKey', {
      enableKeyRotation: true,
      description: 'KMS key for encrypting submissions data in DynamoDB',
    });

    // DynamoDB Table to store form submissions
    const submissionsTable = new dynamodb.Table(this, 'SubmissionsTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Lambda for handling form submissions
    const submitHandler = new lambda.Function(this, 'SubmitHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { DynamoDB } = require('aws-sdk');
        const { v4: uuidv4 } = require('uuid');
        const dynamodb = new DynamoDB.DocumentClient();

        exports.handler = async (event) => {
          try {
            // Parse request body
            const body = JSON.parse(event.body);
            
            // Validate inputs
            if (!body.name || !body.email || !body.message) {
              return {
                statusCode: 400,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Missing required fields: name, email, and message are required' })
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
            
            // Save to DynamoDB
            await dynamodb.put({
              TableName: process.env.SUBMISSIONS_TABLE,
              Item: item
            }).promise();
            
            return {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              },
              body: JSON.stringify({ success: true, id: item.id })
            };
          } catch (error) {
            console.error('Error processing submission:', error);
            
            return {
              statusCode: 500,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              },
              body: JSON.stringify({ error: 'Failed to process submission' })
            };
          }
        };
      `),
      environment: {
        SUBMISSIONS_TABLE: submissionsTable.tableName,
      },
    });
    
    // Grant the Lambda function permissions to write to DynamoDB
    submissionsTable.grantWriteData(submitHandler);
    
    // API Gateway
    const api = new apigateway.RestApi(this, 'SubmissionsApi', {
      description: 'API for handling form submissions',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });
    
    // Create the /submit resource and POST method
    const submissions = api.root.addResource('submit');
    submissions.addMethod('POST', new apigateway.LambdaIntegration(submitHandler, {
      contentHandling: apigateway.ContentHandling.CONVERT_TO_TEXT,
      credentialsPassthrough: false,
    }));
    
    // Frontend S3 Bucket for static website
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For demo purposes - change for production
      autoDeleteObjects: true, // For demo purposes - change for production
      encryption: s3.BucketEncryption.S3_MANAGED,
    });
    
    // CloudFront Origin Access Identity
    const cloudFrontOAI = new cloudfront.OriginAccessIdentity(this, 'CloudFrontOAI');
    
    // Grant CloudFront OAI read access to the bucket
    frontendBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [frontendBucket.arnForObjects('*')],
      principals: [new iam.CanonicalUserPrincipal(cloudFrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
    }));
    
    // CloudFront Distribution - removed certificate since we're not using a real domain
    const distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket, {
          originAccessIdentity: cloudFrontOAI,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });
    
    // Create some sample content for the S3 bucket
    new s3deployment.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deployment.Source.data('index.html', `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Serverless Toy App</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            form { display: flex; flex-direction: column; }
            label { margin-top: 10px; }
            input, textarea { padding: 8px; margin-top: 5px; }
            button { margin-top: 20px; padding: 10px; background: #4CAF50; color: white; border: none; cursor: pointer; }
            button:hover { background: #45a049; }
            .success { color: green; }
            .error { color: red; }
          </style>
        </head>
        <body>
          <h1>Contact Form Submission</h1>
          <form id="submission-form">
            <label for="name">Name:</label>
            <input type="text" id="name" name="name" required>
            
            <label for="email">Email:</label>
            <input type="email" id="email" name="email" required>
            
            <label for="message">Message:</label>
            <textarea id="message" name="message" rows="5" required></textarea>
            
            <button type="submit">Submit</button>
          </form>
          
          <div id="result"></div>
          
          <script>
            document.getElementById('submission-form').addEventListener('submit', async function(e) {
              e.preventDefault();
              
              const name = document.getElementById('name').value;
              const email = document.getElementById('email').value;
              const message = document.getElementById('message').value;
              
              const resultDiv = document.getElementById('result');
              resultDiv.innerHTML = 'Submitting...';
              
              try {
                const response = await fetch('${api.url}submit', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name, email, message })
                });
                
                const data = await response.json();
                
                if (data.success) {
                  resultDiv.innerHTML = '<p class="success">Form submitted successfully!</p>';
                  document.getElementById('submission-form').reset();
                } else {
                  resultDiv.innerHTML = '<p class="error">Error: ' + (data.error || 'Unknown error') + '</p>';
                }
              } catch (error) {
                resultDiv.innerHTML = '<p class="error">Error submitting form. Please try again later.</p>';
                console.error('Error:', error);
              }
            });
          </script>
        </body>
        </html>
      `)],
      destinationBucket: frontendBucket,
    });
    
    // Export the key outputs
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'URL of the CloudFront distribution',
    });
    
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'URL of the API Gateway endpoint',
    });
  }
}
