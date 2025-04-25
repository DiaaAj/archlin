import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

// Get the bucket name from CDK outputs
const getBucketName = async (): Promise<string> => {
  return new Promise((resolve, reject) => {
    exec('npx cdk outputs --json', (error, stdout) => {
      if (error) {
        return reject(`Failed to get CDK outputs: ${error.message}`);
      }
      try {
        const outputs = JSON.parse(stdout);
        const bucketName = outputs.ToyAppStack.FrontendBucketName;
        if (!bucketName) {
          return reject('Bucket name not found in CDK outputs');
        }
        resolve(bucketName);
      } catch (e) {
        reject(`Failed to parse CDK outputs: ${e}`);
      }
    });
  });
};

// Upload frontend content to S3
const uploadFrontend = async () => {
  try {
    const bucketName = await getBucketName();
    console.log(`Uploading frontend content to bucket: ${bucketName}`);

    const frontendDir = path.join(__dirname, 'frontend-content');
    
    // Upload index.html with content type
    exec(
      `aws s3 cp ${path.join(frontendDir, 'index.html')} s3://${bucketName}/index.html --content-type "text/html"`,
      (error, stdout) => {
        if (error) {
          console.error(`Error uploading index.html: ${error.message}`);
          return;
        }
        console.log('Successfully uploaded index.html');
        console.log(stdout);
      }
    );

    // Upload app.js with content type
    exec(
      `aws s3 cp ${path.join(frontendDir, 'app.js')} s3://${bucketName}/app.js --content-type "application/javascript"`,
      (error, stdout) => {
        if (error) {
          console.error(`Error uploading app.js: ${error.message}`);
          return;
        }
        console.log('Successfully uploaded app.js');
        console.log(stdout);
      }
    );

    console.log('Frontend content upload initiated');
  } catch (error) {
    console.error('Failed to upload frontend content:', error);
  }
};

// Run the upload script
uploadFrontend();
