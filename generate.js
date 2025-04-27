// plantuml-to-aws.js - Main application file

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { exec, execSync } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
require('dotenv').config();

// Configuration
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// CLI Configuration
program
  .name('plantuml-to-aws')
  .description('Convert PlantUML diagrams to deployable AWS CDK infrastructure')
  .version('1.0.0')
  .option('-i, --input <path>', 'Path to the PlantUML file')
  .option('-o, --output <directory>', 'Output directory for CDK project', './cdk-output')
  .option('-c, --context <path>', 'Path to a file with additional context for the LLM')
  .option('-d, --deploy', 'Deploy the infrastructure after generation', false)
  .option('-p, --profile <profile>', 'AWS profile to use for deployment')
  .option('-r, --region <region>', 'AWS region to deploy to', 'us-east-1')
  .option('-y, --yes', 'Skip confirmation prompts', false)
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    // Validate input file
    const inputPath = options.input;
    if (!inputPath) {
      console.error(chalk.red('Error: Input file path is required'));
      program.help();
      return;
    }

    const spinner = ora('Starting PlantUML to AWS conversion').start();

    // 1. Read the PlantUML file
    spinner.text = 'Reading PlantUML file';
    const plantUmlContent = await fs.readFile(inputPath, 'utf8');
    spinner.succeed('PlantUML file read successfully');

    // 2. Read additional context if provided
    let contextContent = '';
    if (options.context) {
      try {
        spinner.text = 'Reading context file';
        spinner.start();
        contextContent = await fs.readFile(options.context, 'utf8');
        spinner.succeed('Context file read successfully');
      } catch (error) {
        spinner.fail(`Failed to read context file: ${error.message}`);
        console.error(chalk.yellow('Proceeding without additional context'));
      }
    }

    // 3. Generate CDK code using Claude API
    spinner.text = 'Generating AWS CDK code with Claude';
    spinner.start();
    const files = await generateCdkCode(plantUmlContent, contextContent);
    spinner.succeed(`AWS CDK code generated successfully (${files.length} files)`);

    // 4. Create CDK project structure
    spinner.text = 'Creating CDK project';
    spinner.start();
    const outputDir = path.resolve(options.output);
    await createCdkProject(outputDir, files);
    spinner.succeed(`CDK project created at ${outputDir}`);

    // 5. Install dependencies
    spinner.text = 'Installing dependencies';
    spinner.start();
    await installDependencies(outputDir);
    spinner.succeed('Dependencies installed');

    console.log(chalk.green('\n✨ CDK code has been generated successfully! ✨'));
    console.log(chalk.blue(`You can find the project in: ${outputDir}`));

    // 6. Deploy if requested
    if (options.deploy) {
      await deployCdkProject(outputDir);
    } else {
      console.log(chalk.yellow('\nTo deploy this infrastructure:'));
      console.log(`cd ${outputDir}`);
      console.log('npm run cdk deploy');
    }

  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

// Generate CDK code using Claude API
async function generateCdkCode(plantUmlContent, contextContent = '') {
  if (!CLAUDE_API_KEY) {
    throw new Error('Anthropic API key is not set. Please set the ANTHROPIC_API_KEY environment variable.');
  }

  // Add context section if provided
  const contextSection = contextContent ? 
    `\nAdditional context and requirements:\n${contextContent}\n` : 
    '';

  const prompt = `
I have a PlantUML diagram representing an AWS architecture. Please analyze this diagram and generate a complete, deployable AWS CDK project in TypeScript. Include all necessary files including lib files, bin files, package.json, and tsconfig.json.

The CDK code should:
1. Match the architecture shown in the diagram exactly
2. Include proper IAM permissions and security configurations
3. Use best practices for AWS resource configuration
4. Include comments explaining key components
5. Be immediately deployable with minimal manual changes${contextSection}

The PlantUML diagram is:

\`\`\`
${plantUmlContent}
\`\`\`

IMPORTANT: Format your response as a JSON array of objects, where each object represents a file with the following structure:
[
  {
    "filename": "relative/path/to/file.ts",
    "content": "// The complete file content here..."
  },
  ... additional files ...
]

Include at minimum these essential files:
- bin/app.ts (main entry point)
- lib/stack.ts (the main stack)
- package.json (with all dependencies)
- tsconfig.json
- cdk.json

DO NOT include README.md, test files, or any other documentation files.
DO NOT include any comments or explanations outside of the JSON response. The JSON should be valid and parsable.
`;

  try {
    const response = await axios.post(
      CLAUDE_API_URL,
      {
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        messages: [
          { role: "user", content: prompt }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    // Extract the response text
    const responseText = response.data.content[0].text;

    // Find the JSON array in the response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Could not find properly formatted JSON response');
    }

    // Parse the JSON
    try {
      const files = JSON.parse(jsonMatch[0]);
      return files;
    } catch (error) {
      console.error('Error parsing JSON response:', error);
      throw new Error('Invalid JSON format in response');
    }
  } catch (error) {
    console.error('Error calling Claude API:', error.response?.data || error.message);
    throw new Error('Failed to generate CDK code');
  }
}

// Updated createCdkProject function to work with the structured response format
async function createCdkProject(outputDir, files) {
  // Create the output directory if it doesn't exist
  await fs.mkdir(outputDir, { recursive: true });

  // Write each file to the appropriate location
  for (const file of files) {
    const filePath = path.join(outputDir, file.filename);

    // Create directory structure if it doesn't exist
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Write the file content
    await fs.writeFile(filePath, file.content);
    console.log(chalk.gray(`Created file: ${file.filename}`));
  }

  // Ensure all essential files exist
  await ensureEssentialFiles(outputDir, files);
}

// Helper function to check if a file exists in the generated files
function fileExists(files, filename) {
  return files.some(file => file.filename === filename);
}

// Updated ensureEssentialFiles function
async function ensureEssentialFiles(outputDir, files) {
  const fileMap = files.reduce((map, file) => {
    map[file.filename] = true;
    return map;
  }, {});

  // Default package.json if not present
  if (!fileMap['package.json']) {
    const packageJson = {
      "name": "aws-cdk-project",
      "version": "0.1.0",
      "bin": {
        "aws-cdk-project": "bin/app.js"
      },
      "scripts": {
        "build": "tsc",
        "watch": "tsc -w",
        "test": "jest",
        "cdk": "cdk"
      },
      "devDependencies": {
        "@types/jest": "^29.5.3",
        "@types/node": "20.4.2",
        "aws-cdk": "2.89.0",
        "jest": "^29.6.1",
        "ts-jest": "^29.1.1",
        "ts-node": "^10.9.1",
        "typescript": "~5.1.6"
      },
      "dependencies": {
        "aws-cdk-lib": "2.89.0",
        "constructs": "^10.0.0",
        "source-map-support": "^0.5.21"
      }
    };

    await fs.writeFile(
      path.join(outputDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    console.log(chalk.yellow('Created default package.json file'));
  }

  // Default tsconfig.json if not present
  if (!fileMap['tsconfig.json']) {
    const tsConfig = {
      "compilerOptions": {
        "target": "ES2018",
        "module": "commonjs",
        "lib": ["es2018"],
        "declaration": true,
        "strict": true,
        "noImplicitAny": true,
        "strictNullChecks": true,
        "noImplicitThis": true,
        "alwaysStrict": true,
        "noUnusedLocals": false,
        "noUnusedParameters": false,
        "noImplicitReturns": true,
        "noFallthroughCasesInSwitch": false,
        "inlineSourceMap": true,
        "inlineSources": true,
        "experimentalDecorators": true,
        "strictPropertyInitialization": false,
        "typeRoots": ["./node_modules/@types"]
      },
      "exclude": ["node_modules", "cdk.out"],
      "include": ["bin/**/*", "lib/**/*"]
    };

    await fs.writeFile(
      path.join(outputDir, 'tsconfig.json'),
      JSON.stringify(tsConfig, null, 2)
    );
    console.log(chalk.yellow('Created default tsconfig.json file'));
  }

  // Default cdk.json if not present
  if (!fileMap['cdk.json']) {
    const cdkJson = {
      "app": "npx ts-node --prefer-ts-exts bin/app.ts",
      "watch": {
        "include": ["**"],
        "exclude": [
          "README.md",
          "cdk*.json",
          "**/*.d.ts",
          "**/*.js",
          "tsconfig.json",
          "package*.json",
          "yarn.lock",
          "node_modules",
          "test"
        ]
      },
      "context": {
        "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
        "@aws-cdk/core:checkSecretUsage": true,
        "@aws-cdk/core:target-partitions": ["aws", "aws-cn"],
        "@aws-cdk-containers/ecs-service-extensions:enableDefaultLogDriver": true,
        "@aws-cdk/aws-ec2:uniqueImdsv2TemplateName": true,
        "@aws-cdk/aws-ecs:arnFormatIncludesClusterName": true,
        "@aws-cdk/aws-iam:minimizePolicies": true,
        "@aws-cdk/core:validateSnapshotRemovalPolicy": true,
        "@aws-cdk/aws-codepipeline:crossAccountKeyAliasStackSafeResourceName": true,
        "@aws-cdk/aws-s3:createDefaultLoggingPolicy": true,
        "@aws-cdk/aws-sns-subscriptions:restrictSqsDescryption": true,
        "@aws-cdk/aws-apigateway:disableCloudWatchRole": true,
        "@aws-cdk/core:enablePartitionLiterals": true,
        "@aws-cdk/aws-events:eventsTargetQueueSameAccount": true,
        "@aws-cdk/aws-iam:standardizedServicePrincipals": true,
        "@aws-cdk/aws-ecs:disableExplicitDeploymentControllerForCircuitBreaker": true,
        "@aws-cdk/aws-iam:importedRoleStackSafeDefaultPolicyName": true,
        "@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy": true,
        "@aws-cdk/aws-route53-patters:useCertificate": true,
        "@aws-cdk/customresources:installLatestAwsSdkDefault": false,
        "@aws-cdk/aws-rds:databaseProposedMajorVersionUpgrade": true,
        "@aws-cdk/aws-appsync:useArnForSourceApiAssociationIdentifier": true,
        "@aws-cdk/aws-rds:lowercaseDbIdentifier": true,
        "@aws-cdk/aws-stepfunctions-tasks:enableEmrServicePolicyV2": true,
        "@aws-cdk/aws-ec2:launchTemplateDefaultUserData": true,
        "@aws-cdk/aws-secretsmanager:useAttachedSecretResourcePolicyForSecretTargetAttachments": true,
        "@aws-cdk/aws-redshift:columnId": true
      }
    };

    await fs.writeFile(
      path.join(outputDir, 'cdk.json'),
      JSON.stringify(cdkJson, null, 2)
    );
    console.log(chalk.yellow('Created default cdk.json file'));
  }

  // Create .gitignore if not present
  if (!fileMap['.gitignore']) {
    const gitignore = `# CDK asset staging directory
.cdk.staging
cdk.out

# Dependencies
node_modules

# Compiled output
*.js
!jest.config.js
*.d.ts

# IDE files
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
`;

    await fs.writeFile(path.join(outputDir, '.gitignore'), gitignore);
    console.log(chalk.gray('Created .gitignore file'));
  }
}

// Install dependencies
async function installDependencies(projectDir) {
  try {
    process.chdir(projectDir);
    await execPromise('npm install', { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error('Failed to install dependencies:', error);
    throw new Error('Dependency installation failed');
  }
}

// Deploy CDK project
async function deployCdkProject(projectDir) {
  try {
    // Set AWS profile if provided
    const env = { ...process.env };
    if (options.profile) {
      env.AWS_PROFILE = options.profile;
    }
    env.AWS_REGION = options.region;

    // Change to project directory
    process.chdir(projectDir);

    // Check if user wants to proceed
    if (!options.yes) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow('Are you sure you want to deploy this infrastructure to AWS?'),
        default: false
      }]);

      if (!confirm) {
        console.log(chalk.blue('Deployment cancelled'));
        return;
      }
    }

    // Run CDK bootstrap if needed
    console.log(chalk.blue('Running CDK bootstrap...'));
    await execPromise('npm run cdk bootstrap', {
      stdio: 'inherit',
      env
    });

    // Deploy the CDK stack
    console.log(chalk.blue('Deploying CDK stack...'));
    const spinner = ora('Deploying infrastructure to AWS').start();

    await execPromise('npm run cdk deploy --require-approval never', {
      stdio: 'inherit',
      env
    });

    spinner.succeed(chalk.green('Infrastructure deployed successfully!'));

    // Display outputs
    console.log(chalk.blue('\nStack outputs:'));
    const { stdout } = await execPromise('npm run cdk list-outputs');
    console.log(stdout);

  } catch (error) {
    console.error(chalk.red('Deployment failed:'), error.message);
    console.log(chalk.yellow('You can try deploying manually:'));
    console.log(`cd ${projectDir}`);
    console.log('npm run cdk deploy');
    throw new Error('CDK deployment failed');
  }
}

// Save the original PlantUML diagram and context to the output directory for reference
async function saveSourceFiles(outputDir, plantUmlContent, contextContent) {
  try {
    // Create a source directory
    const sourceDir = path.join(outputDir, 'source');
    await fs.mkdir(sourceDir, { recursive: true });
    
    // Save the PlantUML diagram
    await fs.writeFile(path.join(sourceDir, 'architecture.puml'), plantUmlContent);
    
    // Save the context if provided
    if (contextContent) {
      await fs.writeFile(path.join(sourceDir, 'context.txt'), contextContent);
    }
    
    console.log(chalk.gray('Source files saved for reference'));
  } catch (error) {
    console.log(chalk.yellow(`Could not save source files: ${error.message}`));
  }
}

// Execute main function
main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});