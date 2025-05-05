#!/usr/bin/env node

const axios = require('axios');
const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');

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
 * Generates an HTML page from the documentation
 * @param {Object} documentation - Documentation object with service names as keys
 * @returns {string} - HTML page content
 */
function generateHtmlPage(documentation) {
  const services = Object.keys(documentation);
  
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AWS CDK Documentation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      color: #232f3e;
      border-bottom: 1px solid #eaeded;
      padding-bottom: 10px;
    }
    h2 {
      color: #232f3e;
      margin-top: 30px;
    }
    .service-container {
      margin-bottom: 40px;
      border: 1px solid #eaeded;
      border-radius: 5px;
      padding: 20px;
    }
    .service-header {
      background-color: #fafafa;
      padding: 10px;
      margin: -20px -20px 20px -20px;
      border-bottom: 1px solid #eaeded;
      border-radius: 5px 5px 0 0;
    }
    pre {
      background-color: #f6f8fa;
      border-radius: 3px;
      padding: 10px;
      overflow: auto;
    }
    code {
      font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 85%;
    }
    .nav {
      position: sticky;
      top: 0;
      background: white;
      padding: 10px 0;
      border-bottom: 1px solid #eaeded;
      margin-bottom: 20px;
    }
    .nav ul {
      list-style-type: none;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .nav li {
      margin-right: 10px;
    }
    .nav a {
      text-decoration: none;
      color: #0073bb;
      padding: 5px 10px;
      border-radius: 3px;
    }
    .nav a:hover {
      background-color: #f6f8fa;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 20px;
    }
    th, td {
      border: 1px solid #eaeded;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background-color: #fafafa;
    }
  </style>
</head>
<body>
  <h1>AWS CDK Documentation</h1>
  
  <div class="nav">
    <ul>
      ${services.map(service => `<li><a href="#${service.replace(/\s+/g, '-').toLowerCase()}">${service}</a></li>`).join('')}
    </ul>
  </div>
  
  ${services.map(service => `
    <div id="${service.replace(/\s+/g, '-').toLowerCase()}" class="service-container">
      <div class="service-header">
        <h2>${service}</h2>
      </div>
      ${typeof documentation[service] === 'string' && documentation[service].startsWith('Documentation not found') 
        ? `<p>${documentation[service]}</p>` 
        : documentation[service]}
    </div>
  `).join('')}
</body>
</html>
  `;
  
  return html;
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
    .option('-o, --output <file>', 'Output the results to a file')
    .option('-h, --html', 'Generate HTML output for human readability', false)
    .parse(process.argv);
  
  const options = program.opts();
  const services = options.services.split(',').map(s => s.trim());
  
  console.log(chalk.blue('AWS CDK Documentation MCP Server'));
  console.log(chalk.gray(`Fetching documentation for: ${services.join(', ')}`));
  
  try {
    const documentation = await fetchCdkDocumentation(services);
    
    let outputContent;
    if (options.html) {
      outputContent = generateHtmlPage(documentation);
      console.log(chalk.green('Generated HTML documentation'));
    } else {
      outputContent = options.format ? JSON.stringify(documentation, null, 2) : JSON.stringify(documentation);
      if (options.format) {
        console.log(chalk.green('Documentation fetched successfully'));
      }
    }
    
    if (options.output) {
      const outputPath = path.resolve(options.output);
      fs.writeFileSync(outputPath, outputContent);
      
      let fileTypeHint = '';
      if (options.html && !outputPath.endsWith('.html')) {
        fileTypeHint = ' (HTML content)';
      } else if (!options.html && !outputPath.endsWith('.json')) {
        fileTypeHint = ' (JSON content)';
      }
      
      console.log(chalk.green(`Documentation saved to: ${outputPath}${fileTypeHint}`));
    } else {
      console.log(outputContent);
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
