# n8n MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that lets AI assistants query and manage [n8n](https://n8n.io/) workflow automation instances via the n8n REST API.

## Features

- **Workflows** -- list, inspect, activate, and deactivate workflows
- **Executions** -- list (with date-range filtering), inspect, retry, and stop executions
- **Credentials** -- list credentials and inspect credential schemas
- **Tags** -- list tags and view tags per workflow
- **Users** -- list users and get user details
- **Variables** -- list environment variables
- **Projects** -- list and inspect projects
- **Audit** -- run a security audit on the n8n instance

## Prerequisites

- Node.js >= 18
- An n8n instance with the [REST API enabled](https://docs.n8n.io/api/)
- An API key generated in **n8n Settings > n8n API**

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/<your-org>/n8n-mcp.git
   cd n8n-mcp
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure environment variables:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in your n8n instance URL and API key.

4. Build:

   ```bash
   npm run build
   ```

## Usage

### With Claude Code

Add the server to your Claude Code MCP configuration (`~/.claude.json` or project-level):

```json
{
  "mcpServers": {
    "n8n-api": {
      "command": "node",
      "args": ["/absolute/path/to/n8n-mcp/dist/index.js"],
      "env": {
        "N8N_BASE_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

### With other MCP clients

Run the server over stdio:

```bash
npm start
```

The server communicates via the MCP stdio transport, so it works with any MCP-compatible client.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_workflows` | List workflows with optional name/tag/status filters |
| `get_workflow` | Get full workflow details including nodes and connections |
| `activate_workflow` | Activate a workflow |
| `deactivate_workflow` | Deactivate a workflow |
| `get_workflow_tags` | Get tags for a workflow |
| `list_executions` | List executions with status and date-range filters |
| `get_execution` | Get execution details including node-level data |
| `retry_execution` | Retry a failed execution |
| `stop_execution` | Stop a running execution |
| `list_credentials` | List stored credentials (metadata only) |
| `get_credential_schema` | Get field definitions for a credential type |
| `list_tags` | List all tags |
| `list_users` | List all users |
| `get_user` | Get user details |
| `list_variables` | List environment variables |
| `list_projects` | List all projects |
| `get_project` | Get project details |
| `generate_audit` | Run a security audit |

## Development

```bash
# Build
npm run build

# Run directly
npm start
```

## License

ISC
