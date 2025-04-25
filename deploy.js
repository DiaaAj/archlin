#!/usr/bin/env node

const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
require('dotenv').config();

// CLI Configuration
program
  .name('deploy')
  .description('Deploy an existing AWS CDK project')
  .version('1.0.0')
  .option('-p, --project <directory>', 'Path to the CDK project directory', process.cwd())
  .option('-a, --profile <profile>', 'AWS profile to use for deployment')
  .option('-r, --region <region>', 'AWS region to deploy to', 'us-east-1')
  .option('-y, --yes', 'Skip confirmation prompts', false)
  .option('-s, --stack <stack>', 'Specific stack to deploy (deploys all stacks if not specified)')
  .parse(process.argv);

const options = program.opts();

// Main function
async function main() {
  try {
    const projectDir = path.resolve(options.project);
    
    // Check if the directory contains a CDK project
    const spinner = ora('Validating CDK project').start();
    try {
      // Check for package.json
      await execPromise(`test -f "${projectDir}/package.json"`, { stdio: 'ignore' });
      // Check for cdk.json
      await execPromise(`test -f "${projectDir}/cdk.json"`, { stdio: 'ignore' });
      spinner.succeed('CDK project validated');
    } catch (error) {
      spinner.fail(`Invalid CDK project directory: ${projectDir}`);
      console.error(chalk.red('Make sure the directory contains a valid CDK project with package.json and cdk.json files.'));
      process.exit(1);
    }

    // Check if user wants to proceed
    if (!options.yes) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow(`Are you sure you want to deploy the CDK project in ${projectDir} to AWS?`),
        default: false
      }]);
      
      if (!confirm) {
        console.log(chalk.blue('Deployment cancelled'));
        return;
      }
    }
    
    // Set AWS profile if provided
    const env = { ...process.env };
    if (options.profile) {
      env.AWS_PROFILE = options.profile;
      console.log(chalk.blue(`Using AWS profile: ${options.profile}`));
    }
    env.AWS_REGION = options.region;
    console.log(chalk.blue(`Deploying to region: ${options.region}`));
    
    // Change to project directory
    process.chdir(projectDir);
    
    // Run CDK bootstrap if needed
    console.log(chalk.blue('Running CDK bootstrap...'));
    await execPromise('npx cdk bootstrap', { 
      stdio: 'inherit', 
      env 
    });
    
    // Deploy the CDK stack
    console.log(chalk.blue('Deploying CDK stack...'));
    const deploySpinner = ora('Deploying infrastructure to AWS').start();
    
    let deployCommand = 'npx cdk deploy --require-approval never';
    if (options.stack) {
      deployCommand += ` ${options.stack}`;
    } else {
      deployCommand += ' --all';
    }
    
    try {
      await execPromise(deployCommand, {
        stdio: 'inherit',
        env
      });
      
      deploySpinner.succeed(chalk.green('Infrastructure deployed successfully!'));
      
      // Display outputs
      console.log(chalk.blue('\nStack outputs:'));
      try {
        const { stdout } = await execPromise('npx cdk list-exports');
        console.log(stdout);
      } catch (error) {
        console.log(chalk.yellow('No exports available or could not retrieve them.'));
      }
    } catch (error) {
      deploySpinner.fail(chalk.red('Deployment failed'));
      console.error(error.message);
      process.exit(1);
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

// Execute main function
main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});