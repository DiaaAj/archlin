#!/usr/bin/env node

const axios = require('axios');
const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');

const CDK_DOCS_ROOT_URL = 'https://docs.aws.amazon.com/cdk/api/v2/docs/aws-construct-library.html';

/**
 * Fetches the AWS CDK documentation for a list of services
 * @param {string[]} services - List of AWS service names
 * @returns {Promise<Object>} - JSON object with service documentation
 */
async function fetchCdkDocumentation(services) {
  const spinner = ora('Fetching AWS CDK documentation').start();
  
  try {
    spinner.text = 'Fetching AWS CDK documentation index page';
    const rootPageResponse = await axios.get(CDK_DOCS_ROOT_URL);
    const rootPageHtml = rootPageResponse.data;
    
    spinner.text = 'Parsing service links';
    const serviceLinks = parseServiceLinks(rootPageHtml, services);
    
    const result = {};
    for (const service of services) {
      if (!serviceLinks[service]) {
        spinner.warn(`Could not find documentation link for ${service}`);
        result[service] = `Documentation not found for ${service}`;
        continue;
      }
      
      spinner.text = `Fetching documentation for ${service}`;
      const serviceUrl = new URL(serviceLinks[service], CDK_DOCS_ROOT_URL).href;
      const serviceResponse = await axios.get(serviceUrl);
      const serviceHtml = serviceResponse.data;
      
      result[service] = extractRelevantContent(serviceHtml);
    }
    
    spinner.succeed('Successfully fetched AWS CDK documentation');
    return result;
  } catch (error) {
    spinner.fail(`Error fetching AWS CDK documentation: ${error.message}`);
    throw error;
  }
}

/**
 * Parses the root page to find links to specific service documentation
 * @param {string} rootPageHtml - HTML content of the root page
 * @param {string[]} targetServices - List of services to find links for
 * @returns {Object} - Map of service names to their documentation links
 */
function parseServiceLinks(rootPageHtml, targetServices) {
  const serviceLinks = {};
  
  const normalizedTargetServices = targetServices.map(s => s.toLowerCase());
  
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  let match;
  
  while ((match = linkRegex.exec(rootPageHtml)) !== null) {
    const href = match[1];
    const linkText = match[2].replace(/<[^>]*>/g, '').trim(); // Remove any HTML tags inside the link text
    
    for (const targetService of targetServices) {
      if (
        linkText.toLowerCase() === targetService.toLowerCase() ||
        linkText.toLowerCase().includes(targetService.toLowerCase()) ||
        linkText.toLowerCase().includes(`aws-${targetService.toLowerCase()}`) ||
        linkText.toLowerCase().includes(`aws ${targetService.toLowerCase()}`)
      ) {
        serviceLinks[targetService] = href;
        break;
      }
    }
  }
  
  return serviceLinks;
}

/**
 * Extracts the relevant content from a service documentation page
 * @param {string} serviceHtml - HTML content of the service documentation page
 * @returns {string} - Cleaned HTML content with only the relevant documentation
 */
function extractRelevantContent(serviceHtml) {
  let content = serviceHtml;
  
  content = content.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  
  content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  
  content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  const mainContentMatch = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(content);
  if (mainContentMatch && mainContentMatch[1]) {
    content = mainContentMatch[1];
  } else {
    const contentDivMatch = /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i.exec(content);
    if (contentDivMatch && contentDivMatch[1]) {
      content = contentDivMatch[1];
    }
  }
  
  content = content.replace(/<div[^>]*id=["'](?:header|footer|navigation|sidebar|menu)["'][^>]*>[\s\S]*?<\/div>/gi, '');
  
  return content.trim();
}

/**
 * Main function to run the CDK documentation server
 */
async function main() {
  const program = new Command();
  
  program
    .name('cdk-docs-server')
    .description('Fetch AWS CDK documentation for specified services')
    .version('1.0.0')
    .option('-s, --services <services>', 'Comma-separated list of AWS services', 'Lambda,DynamoDB')
    .option('-f, --format', 'Format the output for better readability', false)
    .parse(process.argv);
  
  const options = program.opts();
  const services = options.services.split(',').map(s => s.trim());
  
  console.log(chalk.blue('AWS CDK Documentation MCP Server'));
  console.log(chalk.gray(`Fetching documentation for: ${services.join(', ')}`));
  
  try {
    const documentation = await fetchCdkDocumentation(services);
    
    if (options.format) {
      console.log(chalk.green('Documentation fetched successfully:'));
      console.log(JSON.stringify(documentation, null, 2));
    } else {
      console.log(JSON.stringify(documentation));
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    fetchCdkDocumentation
  };
}
