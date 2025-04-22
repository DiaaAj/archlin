# PlantUML to AWS Infrastructure Converter

This tool automates the process of converting PlantUML architecture diagrams into deployable AWS CDK infrastructure. It leverages Claude 3.7 Sonnet to interpret PlantUML diagrams and generate complete, deployable AWS CDK projects.

## Features

- Converts PlantUML AWS architecture diagrams to AWS CDK TypeScript code
- Creates a complete CDK project structure with all necessary files
- Installs dependencies automatically
- Optionally deploys the infrastructure directly to AWS
- Uses AWS best practices for resource configuration and security

## Prerequisites

- Node.js 14.x or higher
- AWS CLI configured with appropriate permissions
- AWS CDK globally installed (`npm install -g aws-cdk`)
- An Anthropic API key for Claude

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/plantuml-to-aws.git
cd plantuml-to-aws
```

2. Install dependencies:
```bash
npm install
```

3. Make the script executable:
```bash
chmod +x plantuml-to-aws.js
```

4. Create a `.env` file with your Anthropic API key:
```bash
echo "ANTHROPIC_API_KEY=your-api-key-here" > .env
```

## Usage

### Basic Usage

Convert a PlantUML diagram to CDK code:

```bash
./plantuml-to-aws.js --input diagram.puml --output my-cdk-project
```

### Deploy Directly to AWS

Convert and deploy in one step:

```bash
./plantuml-to-aws.js --input diagram.puml --output my-cdk-project --deploy --profile my-aws-profile --region us-west-2
```

### Options

- `-i, --input <path>`: Path to the PlantUML file (required)
- `-o, --output <directory>`: Output directory for CDK project (default: `./cdk-output`)
- `-d, --deploy`: Deploy the infrastructure after generation
- `-p, --profile <profile>`: AWS profile to use for deployment
- `-r, --region <region>`: AWS region to deploy to (default: `us-east-1`)
- `-y, --yes`: Skip confirmation prompts
- `-h, --help`: Display help information
- `-V, --version`: Output the version number

## PlantUML Diagram Guidelines

For best results, follow these guidelines when creating your PlantUML diagrams:

1. Use the AWS PlantUML library components
2. Clearly define connections between components
3. Use descriptive names for resources
4. Consider adding comments for special configurations

Example:
```
@startuml
!include <awslib/AWSCommon>
!include <awslib/AWSSimplified.puml>
!include <awslib/Compute/all.puml>
!include <awslib/Storage/all.puml>

Lambda(apiFunction, "API Handler", " ")
DynamoDB(userTable, "Users Table", " ")

apiFunction --> userTable
@enduml
```

## Workflow

1. The tool reads your PlantUML diagram
2. Claude 3.7 Sonnet analyzes the diagram and generates appropriate CDK code
3. A complete CDK project is created with all necessary files
4. Dependencies are installed
5. (Optional) The infrastructure is deployed to AWS

## Limitations

- Complex configuration details may need manual adjustments
- Not all AWS services may be correctly interpreted from PlantUML
- Custom configurations might require post-generation edits
- The CDK code quality depends on the clarity of the input diagram

## Troubleshooting

### Deployment Issues

If deployment fails:

1. Check AWS credentials are valid
2. Verify you have permissions to create the resources
3. Review the CDK code for any service-specific issues
4. Try deploying manually with `cd output-dir && npm run cdk deploy`

### API Key Issues

If you encounter authentication errors:

1. Verify your Anthropic API key is correct in the .env file
2. Ensure your API key has not expired or reached usage limits

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.