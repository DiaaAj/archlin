#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
require('dotenv').config();

// Configuration
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_FIX_ATTEMPTS = 5;

// CLI Configuration
program
  .name('fix-cdk-errors')
  .description('Fix AWS CDK deployment errors using Claude')
  .version('1.0.0')
  .option('-p, --project <directory>', 'Path to the CDK project directory', process.cwd())
  .option('-d, --diagram <path>', 'Path to the original PlantUML diagram file')
  .option('-a, --profile <profile>', 'AWS profile to use for deployment')
  .option('-r, --region <region>', 'AWS region to deploy to', 'us-east-1')
  .option('-m, --max-attempts <number>', 'Maximum number of fix attempts', MAX_FIX_ATTEMPTS)
  .parse(process.argv);

const options = program.opts();

// Main function
async function main() {
  try {
    const projectDir = path.resolve(options.project);
    const maxAttempts = parseInt(options.maxAttempts) || MAX_FIX_ATTEMPTS;
    
    // Validate the project directory
    const spinner = ora('Validating CDK project').start();
    try {
      await execPromise(`test -f "${projectDir}/cdk.json"`, { stdio: 'ignore' });
      spinner.succeed('CDK project validated');
    } catch (error) {
      spinner.fail(`Invalid CDK project directory: ${projectDir}`);
      console.error(chalk.red('Make sure the directory contains a valid CDK project with cdk.json file.'));
      process.exit(1);
    }
    
    // Read the original PlantUML diagram if provided
    let plantUmlContent = '';
    if (options.diagram) {
      try {
        plantUmlContent = await fs.readFile(options.diagram, 'utf8');
        console.log(chalk.blue(`Read original PlantUML diagram from ${options.diagram}`));
      } catch (error) {
        console.error(chalk.yellow(`Warning: Could not read diagram file: ${options.diagram}`));
        console.error(chalk.yellow('Proceeding without original diagram context.'));
      }
    }
    
    // Set AWS profile if provided
    const env = { ...process.env };
    if (options.profile) {
      env.AWS_PROFILE = options.profile;
      console.log(chalk.blue(`Using AWS profile: ${options.profile}`));
    }
    env.AWS_REGION = options.region;
    console.log(chalk.blue(`Using AWS region: ${options.region}`));
    
    // Prepare for deployment attempts
    process.chdir(projectDir);
    
    // Start fix attempts loop
    let attempt = 0;
    let lastError = null;
    let success = false;
    
    // Create a history of fix attempts to avoid repeating failed approaches
    const fixHistory = [];
    
    while (attempt < maxAttempts && !success) {
      attempt++;
      console.log(chalk.blue(`\nAttempt ${attempt}/${maxAttempts} to deploy CDK project`));
      
      if (lastError) {
        // Try to fix the error using Claude
        const fixSpinner = ora('Analyzing and fixing deployment errors with Claude').start();
        try {
          const fixedFiles = await fixDeploymentErrors(projectDir, plantUmlContent, lastError, fixHistory);
          
          // Add this fix to history
          fixHistory.push({
            attempt,
            error: {
              message: lastError.message,
              snippet: lastError.stderr?.substring(0, 200) || lastError.message
            },
            fixedFiles: fixedFiles.map(file => ({
              filename: file.filename,
              checksum: calculateChecksum(file.content)
            }))
          });
          
          fixSpinner.succeed('Code fixes applied based on error analysis');
        } catch (error) {
          fixSpinner.fail('Failed to apply fixes');
          console.error(chalk.red('Error applying fixes:', error.message));
          // Continue to the next attempt anyway
        }
      }
      
      // Try to deploy
      const deploySpinner = ora('Deploying CDK project').start();
      try {
        // First synthesize to catch compilation errors
        await execPromise('npm run build && npx cdk synth', { env });
        deploySpinner.text = 'Synthesized successfully, now deploying...';
        
        // Then deploy
        const { stdout, stderr } = await execPromise('npx cdk deploy --require-approval never', { env });
        deploySpinner.succeed(chalk.green('Deployment successful!'));
        console.log(chalk.gray('Deployment output:'));
        console.log(chalk.gray(stdout));
        
        success = true;
      } catch (error) {
        deploySpinner.fail('Deployment failed');
        console.error(chalk.red('Deployment error:'));
        console.error(chalk.gray(error.stdout || ''));
        console.error(chalk.red(error.stderr || error.message));
        
        lastError = {
          message: error.message,
          stdout: error.stdout || '',
          stderr: error.stderr || ''
        };
        
        // Save the error details to a file for reference
        const errorLogPath = path.join(projectDir, `deployment-error-${attempt}.log`);
        await fs.writeFile(errorLogPath, `STDOUT:\n${error.stdout || ''}\n\nSTDERR:\n${error.stderr || ''}`);
        console.log(chalk.yellow(`Error details saved to: ${errorLogPath}`));
        
        if (attempt < maxAttempts) {
          console.log(chalk.blue(`Will attempt fix and retry deployment...`));
        }
      }
    }
    
    // Save fix history for reference
    if (fixHistory.length > 0) {
      const historyPath = path.join(projectDir, 'fix-history.json');
      await fs.writeFile(historyPath, JSON.stringify(fixHistory, null, 2));
      console.log(chalk.blue(`Fix attempt history saved to: ${historyPath}`));
    }
    
    if (success) {
      console.log(chalk.green(`\n✨ CDK deployment succeeded after ${attempt} attempt(s)! ✨`));
      
      // Display stack outputs
      try {
        const { stdout } = await execPromise('npx cdk list-exports', { env });
        console.log(chalk.blue('\nStack outputs:'));
        console.log(stdout);
      } catch (error) {
        console.log(chalk.yellow('Could not retrieve stack outputs.'));
      }
      
      return 0;
    } else {
      console.error(chalk.red(`\n❌ Failed to deploy after ${maxAttempts} fix attempts. ❌`));
      console.error(chalk.yellow('Review the error logs and make manual corrections.'));
      return 1;
    }
    
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
    return 1;
  }
}

// Calculate a simple checksum for a file content
function calculateChecksum(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

// Fix deployment errors using Claude
async function fixDeploymentErrors(projectDir, plantUmlContent, error, fixHistory) {
  if (!CLAUDE_API_KEY) {
    throw new Error('Anthropic API key is not set. Please set the ANTHROPIC_API_KEY environment variable.');
  }
  
  // Extract relevant error information
  const errorText = `${error.stdout || ''}\n${error.stderr || ''}`;
  const relevantFiles = await extractRelevantFiles(errorText, projectDir);
  
  // If no relevant files could be identified, use a more general approach
  if (relevantFiles.length === 0) {
    console.log(chalk.yellow('Could not identify specific files from error. Using general fix approach.'));
    // Add some common files that might need fixing
    try {
      relevantFiles.push({
        path: 'lib/stack.ts',
        content: await fs.readFile(path.join(projectDir, 'lib/stack.ts'), 'utf8')
      });
    } catch (e) {
      console.log(chalk.yellow('Could not read lib/stack.ts'));
    }
  }
  
  console.log(chalk.blue(`Identified ${relevantFiles.length} files that may need fixes:`));
  relevantFiles.forEach(file => console.log(chalk.gray(`- ${file.path}`)));
  
  // Create the prompt
  const filesContent = relevantFiles.map(file => 
    `\`\`\`typescript
// ${file.path}
${file.content}
\`\`\``).join('\n\n');
  
  const diagramContext = plantUmlContent ? 
    `\nThe original PlantUML diagram that was used to generate this CDK project is:\n\n\`\`\`\n${plantUmlContent}\n\`\`\`` :
    '\nNote: The original PlantUML diagram is not available.';
  
  // Generate context from fix history
  let fixHistoryContext = '';
  if (fixHistory && fixHistory.length > 0) {
    fixHistoryContext = `\nPrevious fix attempts:\n`;
    fixHistory.forEach((attempt, index) => {
      fixHistoryContext += `\nAttempt ${attempt.attempt}:
- Error: ${attempt.error.snippet}
- Files modified: ${attempt.fixedFiles.map(f => f.filename).join(', ')}
`;
    });
    
    fixHistoryContext += `\nIMPORTANT: Previous approaches did NOT resolve the issue, so please try a different approach.`;
  }
  
  const prompt = `
I'm trying to deploy an AWS CDK project but encountering errors. I need you to fix the code in the affected files.

${diagramContext}

${fixHistoryContext}

Here are the files that appear to be related to the errors:

${filesContent}

The deployment error is:

\`\`\`
${errorText}
\`\`\`

Please identify the issues and provide corrected versions of the files. 

${fixHistory.length > 0 ? 'The previous approaches failed, so you need to try something different this time.' : ''}

IMPORTANT: Format your response as a JSON array of objects, where each object represents a file with the following structure:
[
  {
    "filename": "relative/path/to/file.ts",
    "content": "// The complete corrected file content here..."
  },
  ... additional files if needed ...
]

Only include files that need to be changed. DO NOT explain the fixes, just provide the corrected files in the JSON format.
`;

  try {
    console.log(chalk.gray('Sending request to Claude...'));
    
    const response = await axios.post(
      CLAUDE_API_URL,
      {
        model: CLAUDE_MODEL,
        max_tokens: 4000,
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

    const responseText = response.data.content[0].text;
    
    // Find the JSON array in the response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Could not find properly formatted JSON response from Claude');
    }
    
    // Parse the JSON
    let fixedFiles;
    try {
      fixedFiles = JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Error parsing JSON response:', error);
      throw new Error('Invalid JSON format in Claude\'s response');
    }
    
    // Apply the fixes
    console.log(chalk.blue(`Applying fixes to ${fixedFiles.length} files:`));
    
    for (const file of fixedFiles) {
      const filePath = path.join(projectDir, file.filename);
      console.log(chalk.gray(`- Updating ${file.filename}`));
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      
      // Write the fixed file
      await fs.writeFile(filePath, file.content);
    }
    
    return fixedFiles;
  } catch (error) {
    console.error('Error calling Claude API:', error.response?.data || error.message);
    throw new Error('Failed to get fixes from Claude');
  }
}

// Extract file paths from error messages
async function extractRelevantFiles(errorText, projectDir) {
  // This is a simple implementation - a more sophisticated version would use regex patterns
  // tailored to different types of CDK/TypeScript errors
  
  const relevantFiles = [];
  const filesMentioned = new Set();
  
  // Common error patterns
  const patterns = [
    /Error at ([^:]+):/g,                 // General error format
    /([^:\s]+\.ts)(?::[0-9]+)?/g,         // TypeScript files with optional line numbers
    /([^:\s]+\.js)(?::[0-9]+)?/g,         // JavaScript files with optional line numbers
    /Cannot find module ['"]([^'"]+)['"]/g, // Missing module errors
    /ENOENT: no such file or directory, open ['"]([^'"]+)['"]/g, // File not found errors
    /from (\/[^:]+):/g,                   // Stack trace file paths
    /at ([^:]+):[0-9]+:[0-9]+/g           // Stack trace with line and column
  ];
  
  // Extract file paths from error text using patterns
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(errorText)) !== null) {
      let filePath = match[1];
      
      // Skip node_modules and standard libraries
      if (filePath.includes('node_modules') || 
          filePath.startsWith('internal/') ||
          filePath === 'module.js') {
        continue;
      }
      
      // Convert absolute paths to relative
      if (path.isAbsolute(filePath) && filePath.startsWith(projectDir)) {
        filePath = path.relative(projectDir, filePath);
      }
      
      // Skip if already processed
      if (filesMentioned.has(filePath)) {
        continue;
      }
      
      filesMentioned.add(filePath);
      
      // Check if file exists and read its content
      try {
        const fullPath = path.join(projectDir, filePath);
        const content = await fs.readFile(fullPath, 'utf8');
        relevantFiles.push({
          path: filePath,
          content
        });
      } catch (error) {
        // File doesn't exist, might be a false positive from the error message
        console.log(chalk.yellow(`Mentioned file not found: ${filePath}`));
      }
    }
  }
  
  return relevantFiles;
}

// Execute main function
main()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });