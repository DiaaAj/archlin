# Infrastructure Automation

![Under Development](https://img.shields.io/badge/-Under%20Development-yellow)
![AWS](https://img.shields.io/badge/-AWS-orange)
![Yet Another LLM Wrapper 🙄](https://img.shields.io/badge/-Yet%20Another%20LLM%20Wrapper%20%F0%9F%99%84-purple)

A tool that converts PlantUML diagrams into deployable AWS CDK infrastructure using Claude.

## What is this?

This tool takes your PlantUML architecture diagrams and turns them into fully functional AWS CDK code that's ready to deploy. It uses Claude to interpret your diagrams and generate TypeScript CDK code that implements your architecture.

## Features

- 🏗️ **Generate** CDK projects from PlantUML diagrams
- 🚀 **Deploy** the infrastructure directly to AWS
- 🔧 **Debug** deployment issues automatically
- 🧩 **Include context** and artifacts information

## Getting Started

### Prerequisites

- Node.js 14+
- AWS account and credentials
- Anthropic API key for Claude

### Installation

1. Clone this repo
2. Run `npm install`
3. Copy `.env.template` to `.env` and add your Anthropic API key

### Usage

```bash
# Generate a CDK project from a PlantUML diagram
node generate.js -i your-diagram.puml -o output-dir

# Include additional context
node generate.js -i your-diagram.puml -o output-dir -c context.txt

# Reference existing artifacts
node generate.js -i your-diagram.puml -o output-dir -a artifacts.yaml

# Deploy the generated CDK project
node deploy.js -p output-dir

# Debug deployment issues
node debug.js -p output-dir
```

## Hear Me Out!



## License

MIT