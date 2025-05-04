// fix-registry.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const chalk = require('chalk');

const REGISTRY_PATH = path.join(__dirname, 'fix-registry.json');
const DEFAULT_REGISTRY = {
  version: "1.0",
  lastUpdated: new Date().toISOString(),
  fixes: []
};

/**
 * Load the fix registry from disk, creating it if it doesn't exist
 */
async function loadRegistry() {
  try {
    // Check if registry file exists
    if (!fsSync.existsSync(REGISTRY_PATH)) {
      console.log(chalk.blue('Creating new fix registry...'));
      await fs.writeFile(REGISTRY_PATH, JSON.stringify(DEFAULT_REGISTRY, null, 2));
      return DEFAULT_REGISTRY;
    }
    
    // Read and parse the registry
    const data = await fs.readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(chalk.yellow(`Error loading fix registry: ${error.message}`));
    console.log(chalk.blue('Creating new fix registry...'));
    await fs.writeFile(REGISTRY_PATH, JSON.stringify(DEFAULT_REGISTRY, null, 2));
    return DEFAULT_REGISTRY;
  }
}

/**
 * Save the fix registry to disk
 */
async function saveRegistry(registry) {
  try {
    registry.lastUpdated = new Date().toISOString();
    await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
    return true;
  } catch (error) {
    console.error(chalk.yellow(`Error saving fix registry: ${error.message}`));
    return false;
  }
}

/**
 * Find relevant fixes for specific AWS components
 */
async function getFixesForComponents(components) {
  const registry = await loadRegistry();
  if (!Array.isArray(components)) {
    components = [components];
  }
  
  return registry.fixes.filter(fix => 
    fix.components.some(comp => components.includes(comp))
  );
}

/**
 * Find fixes related to a specific error pattern
 */
async function getFixesForErrorPattern(errorText) {
  const registry = await loadRegistry();
  
  // Simple matching - could be enhanced with more sophisticated pattern matching
  return registry.fixes.filter(fix => 
    errorText.includes(fix.errorPattern)
  );
}

/**
 * Add a new fix to the registry
 */
async function addFix(fix) {
  const registry = await loadRegistry();
  
  // Generate a unique ID if not provided
  if (!fix.id) {
    fix.id = `fix-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
  
  // Set timestamp if not provided
  if (!fix.lastUpdated) {
    fix.lastUpdated = new Date().toISOString();
  }
  
  registry.fixes.push(fix);
  await saveRegistry(registry);
  
  return fix.id;
}

/**
 * Update an existing fix in the registry
 */
async function updateFix(fixId, updatedData) {
  const registry = await loadRegistry();
  
  const fixIndex = registry.fixes.findIndex(fix => fix.id === fixId);
  if (fixIndex === -1) {
    throw new Error(`Fix with ID ${fixId} not found`);
  }
  
  // Update the fix with new data
  registry.fixes[fixIndex] = {
    ...registry.fixes[fixIndex],
    ...updatedData,
    lastUpdated: new Date().toISOString()
  };
  
  await saveRegistry(registry);
  return registry.fixes[fixIndex];
}

/**
 * Extract AWS components from error message or code
 */
function extractComponentsFromError(error) {
  const components = new Set();
  
  const commonComponents = [
    'Lambda', 'S3', 'DynamoDB', 'API Gateway', 'CloudFront', 
    'EventBridge', 'SNS', 'SQS', 'EC2', 'VPC', 'IAM',
    'CloudFormation', 'CloudWatch', 'ECS', 'EKS', 'RDS'
  ];
  
  const errorText = `${error.stdout || ''} ${error.stderr || ''} ${error.message || ''}`;
  
  for (const component of commonComponents) {
    // Look for component names in the error text
    if (errorText.includes(component) || 
        errorText.toLowerCase().includes(component.toLowerCase())) {
      components.add(component);
    }
  }
  
  // Look for CDK construct patterns
  const cdkPatterns = {
    'lambda': 'Lambda',
    'bucket': 'S3',
    'table': 'DynamoDB',
    'api': 'API Gateway',
    'distribution': 'CloudFront',
    'rule': 'EventBridge',
    'topic': 'SNS',
    'queue': 'SQS',
    'instance': 'EC2',
    'vpc': 'VPC',
    'role': 'IAM'
  };
  
  for (const [pattern, component] of Object.entries(cdkPatterns)) {
    if (errorText.includes(pattern)) {
      components.add(component);
    }
  }
  
  return Array.from(components);
}

/**
 * Extract a concise error pattern from the error message
 */
function extractErrorPattern(error) {
  const errorText = error.stderr || error.message || '';
  
  // Try to find the most specific error message
  // Common patterns in CDK/AWS errors
  const patterns = [
    /is not authorized to perform: ([^\s]+) on resource/,
    /Resource handler returned message: \"([^\"]+)\"/,
    /Error: ([^\n]+)/,
    /ValidationError: ([^\n]+)/,
    /Cannot ([^\n:]+)/
  ];
  
  for (const pattern of patterns) {
    const match = errorText.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  // Fall back to the first line of the error if no pattern matches
  const firstLine = errorText.split('\n')[0].trim();
  return firstLine.substring(0, 100); // Limit length
}

/**
 * Create a concise summary of the solution based on modified files
 */
function summarizeSolution(files) {
  if (!files || files.length === 0) {
    return "No files were modified";
  }
  
  // Create a summary of what was changed
  return files.map(file => {
    const filename = file.filename;
    const content = file.content;
    
    // Very basic summary - this could be enhanced with more sophisticated code analysis
    const lineCount = content.split('\n').length;
    return `Modified ${filename} (${lineCount} lines)`;
  }).join('; ');
}

/**
 * Get CDK version from a project directory
 */
async function getCdkVersion(projectDir) {
  try {
    // Try to read package.json
    const packagePath = path.join(projectDir, 'package.json');
    const packageData = await fs.readFile(packagePath, 'utf8');
    const pkg = JSON.parse(packageData);
    
    // Check dependencies for CDK version
    if (pkg.dependencies && pkg.dependencies['aws-cdk-lib']) {
      return pkg.dependencies['aws-cdk-lib'];
    }
    
    // Fall back to a default if not found
    return '2.x';
  } catch (error) {
    console.log(chalk.yellow(`Could not determine CDK version: ${error.message}`));
    return '2.x';
  }
}

/**
 * Generates a hash fingerprint from the entire error message
 */
function generateErrorHash(error) {
  // Combine all error information into a single string
  const errorText = `${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`;
  
  // Clean up the error text by removing variable parts
  const cleanedText = cleanErrorText(errorText);
  
  // Calculate a simple hash
  return {
    hash: calculateHash(cleanedText),
    cleanedText: cleanedText
  };
    
}

/**
 * Cleans error text by removing parts that change between runs
 */
function cleanErrorText(text) {
  return text
    // Remove timestamps
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g, 'TIMESTAMP')
    // Remove UUIDs and other hex identifiers
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    // Remove request IDs
    .replace(/request id: [a-z0-9-]+/gi, 'request id: REQUEST_ID')
    // Remove paths that include the user directory
    .replace(new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'PROJECT_DIR')
    // Remove line numbers in file references (they may shift)
    .replace(/\.ts\(\d+,\d+\)/g, '.ts(LINE,COL)')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates a hash from a string
 * Using a simple algorithm but good enough for our purpose
 */
function calculateHash(text) {
  let hash = 0;
  if (text.length === 0) return hash.toString(16);
  
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Return as hex string
  return hash.toString(16);
}

/**
 * Compare two errors using their hash fingerprints
 */
function isSameErrorByHash(error1, error2) {
  if (!error1 || !error2) return false;
  
  const hash1 = generateErrorHash(error1);
  const hash2 = generateErrorHash(error2);
  
  return hash1 === hash2;
}

module.exports = {
  loadRegistry,
  saveRegistry,
  getFixesForComponents,
  getFixesForErrorPattern,
  addFix,
  updateFix,
  extractComponentsFromError,
  extractErrorPattern,
  summarizeSolution,
  getCdkVersion,
  generateErrorHash,
  isSameErrorByHash
};