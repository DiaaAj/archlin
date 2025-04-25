import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export class ServerlessArchitectureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // KMS Key for encryption
    const kmsKey = new kms.Key(this, 'EncryptionKey', {
      enableKeyRotation: true,
      description: 'KMS key for encrypting S3 objects and other resources',
    });

    // S3 Buckets
    const rawBucket = new s3.Bucket(this, 'RawBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    const validatedBucket = new s3.Bucket(this, 'ValidatedBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
    });

    const processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
    });

    const auditBucket = new s3.Bucket(this, 'AuditBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(365),
        },
      ],
    });

    // DynamoDB Tables
    const metadataTable = new dynamodb.Table(this, 'MetadataTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      pointInTimeRecovery: true,
    });

    const logsTable = new dynamodb.Table(this, 'LogsTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // Dead Letter Queue (DLQ)
    const dlq = new sqs.Queue(this, 'DLQ', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey,
      enforceSSL: true,
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(14),
    });

    // EventBridge
    const eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: 'ServerlessArchitectureEventBus',
    });

    // Lambda Functions
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Common Lambda props
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        KMS_KEY_ID: kmsKey.keyId,
        EVENT_BUS_NAME: eventBus.eventBusName,
        METADATA_TABLE: metadataTable.tableName,
        LOGS_TABLE: logsTable.tableName,
        RAW_BUCKET: rawBucket.bucketName,
        VALIDATED_BUCKET: validatedBucket.bucketName,
        PROCESSED_BUCKET: processedBucket.bucketName,
        DLQ_URL: dlq.queueUrl,
      },
      role: lambdaExecutionRole,
    };

    // Create Lambda functions
    const validatorLambda = new lambda.Function(this, 'ValidatorLambda', {
      ...commonLambdaProps,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Validating file:', JSON.stringify(event));
          // Validation logic would go here
          return { isValid: true, metadata: { fileId: 'example-id', fileName: 'example.txt' } };
        };
      `),
      description: 'Validates files for format and size',
    });

    const enricherLambda = new lambda.Function(this, 'EnricherLambda', {
      ...commonLambdaProps,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Enriching metadata:', JSON.stringify(event));
          // Enrichment logic would go here
          return { ...event, enriched: true, timestamp: new Date().toISOString() };
        };
      `),
      description: 'Adds metadata to files',
    });

    const processorLambda = new lambda.Function(this, 'ProcessorLambda', {
      ...commonLambdaProps,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Processing file:', JSON.stringify(event));
          // Processing logic would go here
          return { processed: true, metadata: event.metadata };
        };
      `),
      description: 'Processes validated files (compress, encrypt)',
    });

    const publisherLambda = new lambda.Function(this, 'PublisherLambda', {
      ...commonLambdaProps,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Publishing file:', JSON.stringify(event));
          // Publishing logic would go here
          return { published: true, metadata: event.metadata };
        };
      `),
      description: 'Publishes processed files',
    });

    const loggerLambda = new lambda.Function(this, 'LoggerLambda', {
      ...commonLambdaProps,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Logging event:', JSON.stringify(event));
          // Logging logic would go here
          return { logged: true };
        };
      `),
      description: 'Logs file lifecycle events',
    });

    const apiLambda = new lambda.Function(this, 'ApiLambda', {
      ...commonLambdaProps,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('API request:', JSON.stringify(event));
          // API logic would go here
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Success' })
          };
        };
      `),
      description: 'Serves API requests for metadata and file access',
    });

    // Grant permissions
    rawBucket.grantRead(validatorLambda);
    validatedBucket.grantWrite(validatorLambda);
    validatedBucket.grantRead(processorLambda);
    processedBucket.grantWrite(processorLambda);
    processedBucket.grantRead(publisherLambda);
    processedBucket.grantReadWrite(apiLambda);
    metadataTable.grantWriteData(enricherLambda);
    metadataTable.grantReadData(apiLambda);
    logsTable.grantWriteData(loggerLambda);
    dlq.grantSendMessages(validatorLambda);
    eventBus.grantPutEventsTo(validatorLambda);
    eventBus.grantPutEventsTo(enricherLambda);
    eventBus.grantPutEventsTo(processorLambda);
    eventBus.grantPutEventsTo(publisherLambda);
    kmsKey.grantEncryptDecrypt(validatorLambda);
    kmsKey.grantEncryptDecrypt(enricherLambda);
    kmsKey.grantEncryptDecrypt(processorLambda);
    kmsKey.grantEncryptDecrypt(publisherLambda);
    kmsKey.grantEncryptDecrypt(loggerLambda);
    kmsKey.grantEncryptDecrypt(apiLambda);

    // Firehose
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });

    auditBucket.grantWrite(firehoseRole);
    kmsKey.grantEncryptDecrypt(firehoseRole);

    // Create Firehose delivery stream with standard API instead of alpha
    const auditFirehose = new firehose.CfnDeliveryStream(this, 'AuditStream', {
      deliveryStreamName: 'AuditDeliveryStream',
      deliveryStreamType: 'DirectPut',
      s3DestinationConfiguration: {
        bucketArn: auditBucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        bufferingHints: {
          intervalInSeconds: 60,
          sizeInMBs: 1
        },
        compressionFormat: 'GZIP',
        encryptionConfiguration: {
          kmsEncryptionConfig: {
            awskmsKeyArn: kmsKey.keyArn
          }
        },
        prefix: 'audit/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        errorOutputPrefix: 'audit-errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/'
      }
    });

    // Grant Firehose permissions to publisherLambda
    publisherLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
      resources: [auditFirehose.attrArn],
    }));

    // Step Functions
    // Ingestion State Machine
    const validateTask = new tasks.LambdaInvoke(this, 'ValidateTask', {
      lambdaFunction: validatorLambda,
      resultPath: '$.validationResult',
    });

    const enrichTask = new tasks.LambdaInvoke(this, 'EnrichTask', {
      lambdaFunction: enricherLambda,
      resultPath: '$.enrichmentResult',
    });

    const sendToDlqTask = new tasks.SqsSendMessage(this, 'SendToDLQ', {
      queue: dlq,
      messageBody: sfn.TaskInput.fromObject({
        error: 'Validation failed',
        originalPayload: sfn.JsonPath.stringAt('$'),
      }),
      resultPath: '$.dlqResult',
    });

    const ingestionDefinition = validateTask
      .next(new sfn.Choice(this, 'IsFileValid')
        .when(
          sfn.Condition.booleanEquals('$.validationResult.Payload.isValid', true),
          enrichTask
        )
        .otherwise(sendToDlqTask));

    const ingestionStateMachine = new sfn.StateMachine(this, 'IngestionStateMachine', {
      definition: ingestionDefinition,
      stateMachineName: 'FileIngestionWorkflow',
      timeout: cdk.Duration.minutes(5),
    });

    // Publishing State Machine
    const processTask = new tasks.LambdaInvoke(this, 'ProcessTask', {
      lambdaFunction: processorLambda,
      resultPath: '$.processingResult',
    });

    const publishTask = new tasks.LambdaInvoke(this, 'PublishTask', {
      lambdaFunction: publisherLambda,
      resultPath: '$.publishingResult',
    });

    const publishingDefinition = processTask.next(publishTask);

    const publishingStateMachine = new sfn.StateMachine(this, 'PublishingStateMachine', {
      definition: publishingDefinition,
      stateMachineName: 'FilePublishingWorkflow',
      timeout: cdk.Duration.minutes(5),
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'FileProcessingApi', {
      restApiName: 'File Processing Service',
      description: 'API for accessing file metadata and generating pre-signed URLs',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
    });

    const apiIntegration = new apigateway.LambdaIntegration(apiLambda);

    // API resources
    const filesResource = api.root.addResource('files');
    filesResource.addMethod('GET', apiIntegration);  // List files
    filesResource.addMethod('POST', apiIntegration);  // Upload files
    
    const fileResource = filesResource.addResource('{fileId}');
    fileResource.addMethod('GET', apiIntegration);  // Get file metadata
    fileResource.addMethod('DELETE', apiIntegration);  // Delete file
    
    const downloadResource = fileResource.addResource('download');
    downloadResource.addMethod('GET', apiIntegration);  // Generate pre-signed URL

    // Event Rules
    // Raw bucket upload rule
    new events.Rule(this, 'RawBucketUploadRule', {
      eventBus,
      description: 'Triggers when a new file is uploaded to the raw bucket',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [rawBucket.bucketName],
          },
        },
      },
      targets: [new targets.SfnStateMachine(ingestionStateMachine)],
    });

    // Validated bucket event rule
    new events.Rule(this, 'ValidatedBucketRule', {
      eventBus,
      description: 'Triggers when a file is validated',
      eventPattern: {
        source: ['custom.fileProcessing'],
        detailType: ['FileValidated'],
        detail: {
          bucket: {
            name: [validatedBucket.bucketName],
          },
        },
      },
      targets: [new targets.SfnStateMachine(publishingStateMachine)],
    });

    // Logger event rule - captures all events
    new events.Rule(this, 'LoggerRule', {
      eventBus,
      description: 'Logs all file lifecycle events',
      eventPattern: {
        source: [''],  // All sources
      },
      targets: [new targets.LambdaFunction(loggerLambda)],
    });

    // CloudWatch Alarms
    // DLQ Depth Alarm
    const dlqDepthAlarm = new cloudwatch.Alarm(this, 'DLQDepthAlarm', {
      metric: dlq.metricApproximateNumberOfMessagesVisible(),
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if DLQ has messages',
    });

    // Failed State Machine executions alarm
    const publishingFailuresAlarm = new cloudwatch.Alarm(this, 'PublishingFailuresAlarm', {
      metric: publishingStateMachine.metricFailed(),
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm on failed publishing workflow executions',
    });

    // Outputs
    new cdk.CfnOutput(this, 'RawBucketName', {
      value: rawBucket.bucketName,
      description: 'The name of the raw bucket',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'The endpoint URL of the API Gateway',
    });

    new cdk.CfnOutput(this, 'MetadataTableName', {
      value: metadataTable.tableName,
      description: 'The name of the metadata DynamoDB table',
    });
  }
}
