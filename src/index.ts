import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { N8nClient } from "./n8n-client.js";

// ── Validate env ──────────────────────────────────────────────────────

const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_BASE_URL || !N8N_API_KEY) {
  console.error("Missing required env vars: N8N_BASE_URL and N8N_API_KEY");
  process.exit(1);
}

const client = new N8nClient(N8N_BASE_URL, N8N_API_KEY);

// ── MCP Server ────────────────────────────────────────────────────────

const server = new McpServer({
  name: "n8n",
  version: "1.0.0",
});

// Helper: wrap tool handlers so they return JSON text content
function jsonResult(data: unknown) {
  // Use compact JSON for arrays/lists to reduce response size; pretty-print single objects
  const isCollection = data != null && typeof data === "object" && ("data" in (data as Record<string, unknown>));
  const text = isCollection ? JSON.stringify(data) : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

async function handleError(fn: () => Promise<unknown>) {
  try {
    return jsonResult(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

// ── Workflow tools ────────────────────────────────────────────────────

server.tool(
  "list_workflows",
  "List all workflows in the n8n instance. Supports filtering by name, active status, and tags.",
  {
    limit: z.number().optional().describe("Max results per page (default 100, max 250)"),
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
    name: z.string().optional().describe("Filter by workflow name (substring match)"),
    active: z.boolean().optional().describe("Filter by active/inactive status"),
    tags: z.string().optional().describe("Comma-separated tag names to filter by"),
    projectId: z.string().optional().describe("Filter by project ID"),
  },
  async (params) => handleError(() => client.listWorkflows(params)),
);

server.tool(
  "get_workflow",
  "Get full details of a specific workflow by ID, including its nodes and connections.",
  {
    id: z.string().describe("Workflow ID"),
  },
  async ({ id }) => handleError(() => client.getWorkflow(id)),
);

server.tool(
  "activate_workflow",
  "Activate a workflow so it starts listening for triggers.",
  {
    id: z.string().describe("Workflow ID to activate"),
  },
  async ({ id }) => handleError(() => client.activateWorkflow(id)),
);

server.tool(
  "deactivate_workflow",
  "Deactivate a workflow so it stops listening for triggers.",
  {
    id: z.string().describe("Workflow ID to deactivate"),
  },
  async ({ id }) => handleError(() => client.deactivateWorkflow(id)),
);

server.tool(
  "get_workflow_tags",
  "Get all tags assigned to a specific workflow.",
  {
    id: z.string().describe("Workflow ID"),
  },
  async ({ id }) => handleError(() => client.getWorkflowTags(id)),
);

// ── Execution tools ──────────────────────────────────────────────────

server.tool(
  "list_executions",
  "List workflow executions. Filter by status (error, success, waiting, running) or workflow ID. Supports date range filtering via startedAfter/startedBefore (ISO 8601 or YYYY-MM-DD).",
  {
    limit: z.number().optional().describe("Max results per page (default 100, max 250)"),
    cursor: z.string().optional().describe("Pagination cursor"),
    status: z.string().optional().describe("Filter by status: error, success, waiting, running"),
    workflowId: z.string().optional().describe("Filter by workflow ID"),
    projectId: z.string().optional().describe("Filter by project ID"),
    startedAfter: z.string().optional().describe("Only include executions started after this date/time (ISO 8601 or YYYY-MM-DD)"),
    startedBefore: z.string().optional().describe("Only include executions started before this date/time (ISO 8601 or YYYY-MM-DD)"),
  },
  async (params) => handleError(() => client.listExecutions(params)),
);

server.tool(
  "get_execution",
  "Get detailed information about a specific execution, including node-level data.",
  {
    id: z.string().describe("Execution ID"),
  },
  async ({ id }) => handleError(() => client.getExecution(id)),
);

server.tool(
  "retry_execution",
  "Retry a failed execution.",
  {
    id: z.string().describe("Execution ID to retry"),
  },
  async ({ id }) => handleError(() => client.retryExecution(id)),
);

server.tool(
  "stop_execution",
  "Stop a currently running execution.",
  {
    id: z.string().describe("Execution ID to stop"),
  },
  async ({ id }) => handleError(() => client.stopExecution(id)),
);

// ── Credential tools ────────────────────────────────────────────────

server.tool(
  "list_credentials",
  "List all credentials stored in n8n (returns metadata only, not secret values).",
  {
    limit: z.number().optional().describe("Max results per page"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async (params) => handleError(() => client.listCredentials(params)),
);

server.tool(
  "get_credential_schema",
  "Get the schema/field definition for a specific credential type (e.g. 'slackApi', 'githubApi').",
  {
    typeName: z.string().describe("Credential type name"),
  },
  async ({ typeName }) => handleError(() => client.getCredentialSchema(typeName)),
);

// ── Tag tools ───────────────────────────────────────────────────────

server.tool(
  "list_tags",
  "List all tags used to organize workflows.",
  {
    limit: z.number().optional().describe("Max results per page"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async (params) => handleError(() => client.listTags(params)),
);

// ── User tools ──────────────────────────────────────────────────────

server.tool(
  "list_users",
  "List all users in the n8n instance.",
  {
    limit: z.number().optional().describe("Max results per page"),
    cursor: z.string().optional().describe("Pagination cursor"),
    includeRole: z.boolean().optional().describe("Include user role in response"),
  },
  async (params) => handleError(() => client.listUsers(params)),
);

server.tool(
  "get_user",
  "Get details of a specific user by ID.",
  {
    id: z.string().describe("User ID"),
  },
  async ({ id }) => handleError(() => client.getUser(id)),
);

// ── Variable tools ──────────────────────────────────────────────────

server.tool(
  "list_variables",
  "List all environment variables configured in n8n.",
  {
    limit: z.number().optional().describe("Max results per page"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async (params) => handleError(() => client.listVariables(params)),
);

// ── Project tools ───────────────────────────────────────────────────

server.tool(
  "list_projects",
  "List all projects in the n8n instance.",
  {
    limit: z.number().optional().describe("Max results per page"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async (params) => handleError(() => client.listProjects(params)),
);

server.tool(
  "get_project",
  "Get details of a specific project by ID.",
  {
    id: z.string().describe("Project ID"),
  },
  async ({ id }) => handleError(() => client.getProject(id)),
);

// ── Audit tool ──────────────────────────────────────────────────────

server.tool(
  "generate_audit",
  "Run a security audit on the n8n instance and return the findings.",
  {},
  async () => handleError(() => client.generateAudit()),
);

// ── Start server ────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
