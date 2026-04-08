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
  "create_workflow",
  "Create a new workflow. Requires name, nodes array, connections object, and settings object.",
  {
    name: z.string().describe("Workflow name"),
    nodes: z.array(z.record(z.string(), z.unknown())).describe("Array of node objects"),
    connections: z.record(z.string(), z.unknown()).describe("Connections object mapping node outputs to inputs"),
    settings: z.record(z.string(), z.unknown()).describe("Workflow settings (e.g. errorWorkflow, timezone, executionOrder)"),
  },
  async (params) => handleError(() => client.createWorkflow(params as { name: string; nodes: unknown[]; connections: unknown; settings: unknown })),
);

server.tool(
  "update_workflow",
  "Update an existing workflow. Requires the full workflow definition (name, nodes, connections, settings).",
  {
    id: z.string().describe("Workflow ID to update"),
    name: z.string().describe("Workflow name"),
    nodes: z.array(z.record(z.string(), z.unknown())).describe("Array of node objects"),
    connections: z.record(z.string(), z.unknown()).describe("Connections object"),
    settings: z.record(z.string(), z.unknown()).describe("Workflow settings"),
  },
  async ({ id, ...body }) => handleError(() => client.updateWorkflow(id, body as { name: string; nodes: unknown[]; connections: unknown; settings: unknown })),
);

server.tool(
  "delete_workflow",
  "Delete a workflow by ID. This also deletes its execution history.",
  {
    id: z.string().describe("Workflow ID to delete"),
  },
  async ({ id }) => handleError(() => client.deleteWorkflow(id)),
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

server.tool(
  "update_workflow_tags",
  "Replace all tags on a workflow with the given tag IDs.",
  {
    id: z.string().describe("Workflow ID"),
    tagIds: z.array(z.object({ id: z.string() })).describe("Array of tag ID objects, e.g. [{id: 'abc'}, {id: 'def'}]"),
  },
  async ({ id, tagIds }) => handleError(() => client.updateWorkflowTags(id, tagIds)),
);

server.tool(
  "transfer_workflow",
  "Transfer a workflow to another project.",
  {
    id: z.string().describe("Workflow ID to transfer"),
    destinationProjectId: z.string().describe("Target project ID"),
  },
  async ({ id, destinationProjectId }) => handleError(() => client.transferWorkflow(id, destinationProjectId)),
);

// ── Execution tools ──────────────────────────────────────────────────

server.tool(
  "list_executions",
  "List workflow executions. Filter by status or workflow ID. Supports date range filtering via startedAfter/startedBefore (ISO 8601 or YYYY-MM-DD).",
  {
    limit: z.number().optional().describe("Max results per page (default 100, max 250)"),
    cursor: z.string().optional().describe("Pagination cursor"),
    status: z.string().optional().describe("Filter by status: canceled, crashed, error, new, running, success, unknown, waiting"),
    workflowId: z.string().optional().describe("Filter by workflow ID"),
    projectId: z.string().optional().describe("Filter by project ID"),
    includeData: z.boolean().optional().describe("Include full execution data with node-level results (default false). WARNING: can produce very large responses"),
    startedAfter: z.string().optional().describe("Only include executions started after this date/time (ISO 8601 or YYYY-MM-DD)"),
    startedBefore: z.string().optional().describe("Only include executions started before this date/time (ISO 8601 or YYYY-MM-DD)"),
  },
  async (params) => handleError(() => client.listExecutions(params)),
);

server.tool(
  "get_execution",
  "Get information about a specific execution. By default returns metadata only. Use includeData=true for node-level results, with optional filtering via nodeNames and truncateData to manage response size.",
  {
    id: z.string().describe("Execution ID"),
    includeData: z.boolean().optional().describe("Include full execution data with node-level results (default false)"),
    nodeNames: z.array(z.string()).optional().describe("When includeData is true, only return data for these specific node names"),
    truncateData: z.boolean().optional().describe("When includeData is true, limit to 5 items per node output to prevent context overflow"),
  },
  async ({ id, ...opts }) => handleError(() => client.getExecution(id, opts)),
);

server.tool(
  "get_execution_tags",
  "Get annotation tags for a specific execution.",
  {
    id: z.string().describe("Execution ID"),
  },
  async ({ id }) => handleError(() => client.getExecutionTags(id)),
);

server.tool(
  "delete_execution",
  "Delete a specific execution by ID.",
  {
    id: z.string().describe("Execution ID to delete"),
  },
  async ({ id }) => handleError(() => client.deleteExecution(id)),
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
  "create_credential",
  "Create a new credential. Use get_credential_schema first to see required fields for the credential type.",
  {
    name: z.string().describe("Credential name"),
    type: z.string().describe("Credential type (e.g. 'slackApi', 'githubApi')"),
    data: z.record(z.string(), z.unknown()).describe("Credential data object with the required fields for this type"),
  },
  async (params) => handleError(() => client.createCredential(params as { name: string; type: string; data: Record<string, unknown> })),
);

server.tool(
  "update_credential",
  "Update an existing credential. All fields are optional.",
  {
    id: z.string().describe("Credential ID to update"),
    name: z.string().optional().describe("New credential name"),
    type: z.string().optional().describe("New credential type (requires data to also be provided)"),
    data: z.record(z.string(), z.unknown()).optional().describe("New credential data"),
  },
  async ({ id, ...body }) => handleError(() => client.updateCredential(id, body as { name?: string; type?: string; data?: Record<string, unknown> })),
);

server.tool(
  "delete_credential",
  "Delete a credential by ID.",
  {
    id: z.string().describe("Credential ID to delete"),
  },
  async ({ id }) => handleError(() => client.deleteCredential(id)),
);

server.tool(
  "transfer_credential",
  "Transfer a credential to another project.",
  {
    id: z.string().describe("Credential ID to transfer"),
    destinationProjectId: z.string().describe("Target project ID"),
  },
  async ({ id, destinationProjectId }) => handleError(() => client.transferCredential(id, destinationProjectId)),
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

server.tool(
  "create_tag",
  "Create a new tag.",
  {
    name: z.string().describe("Tag name"),
  },
  async ({ name }) => handleError(() => client.createTag(name)),
);

server.tool(
  "update_tag",
  "Rename an existing tag.",
  {
    id: z.string().describe("Tag ID to update"),
    name: z.string().describe("New tag name"),
  },
  async ({ id, name }) => handleError(() => client.updateTag(id, name)),
);

server.tool(
  "delete_tag",
  "Delete a tag by ID.",
  {
    id: z.string().describe("Tag ID to delete"),
  },
  async ({ id }) => handleError(() => client.deleteTag(id)),
);

// ── User tools ──────────────────────────────────────────────────────

server.tool(
  "list_users",
  "List all users in the n8n instance. Can filter by project to see project members.",
  {
    limit: z.number().optional().describe("Max results per page"),
    cursor: z.string().optional().describe("Pagination cursor"),
    includeRole: z.boolean().optional().describe("Include user role in response"),
    projectId: z.string().optional().describe("Filter users by project ID"),
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
    projectId: z.string().optional().describe("Filter by project ID"),
    state: z.string().optional().describe("Filter by state (e.g. 'empty')"),
  },
  async (params) => handleError(() => client.listVariables(params)),
);

server.tool(
  "create_variable",
  "Create a new environment variable.",
  {
    key: z.string().describe("Variable key"),
    value: z.string().describe("Variable value"),
    projectId: z.string().optional().describe("Project ID to scope the variable to"),
  },
  async (params) => handleError(() => client.createVariable(params)),
);

server.tool(
  "delete_variable",
  "Delete an environment variable by ID.",
  {
    id: z.string().describe("Variable ID to delete"),
  },
  async ({ id }) => handleError(() => client.deleteVariable(id)),
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

server.tool(
  "create_project",
  "Create a new project.",
  {
    name: z.string().describe("Project name"),
  },
  async ({ name }) => handleError(() => client.createProject(name)),
);

server.tool(
  "update_project",
  "Update a project's name.",
  {
    id: z.string().describe("Project ID to update"),
    name: z.string().describe("New project name"),
  },
  async ({ id, name }) => handleError(() => client.updateProject(id, name)),
);

server.tool(
  "delete_project",
  "Delete a project by ID.",
  {
    id: z.string().describe("Project ID to delete"),
  },
  async ({ id }) => handleError(() => client.deleteProject(id)),
);

server.tool(
  "list_project_users",
  "List all members of a project with their roles.",
  {
    id: z.string().describe("Project ID"),
    limit: z.number().optional().describe("Max results per page"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ id, ...opts }) => handleError(() => client.listProjectUsers(id, opts)),
);

server.tool(
  "add_project_users",
  "Add one or more users to a project with specified roles.",
  {
    id: z.string().describe("Project ID"),
    relations: z.array(z.object({
      userId: z.string().describe("User ID"),
      role: z.string().describe("Role (e.g. 'project:admin', 'project:editor', 'project:viewer')"),
    })).describe("Array of user/role pairs to add"),
  },
  async ({ id, relations }) => handleError(() => client.addProjectUsers(id, relations)),
);

server.tool(
  "remove_project_user",
  "Remove a user from a project.",
  {
    projectId: z.string().describe("Project ID"),
    userId: z.string().describe("User ID to remove"),
  },
  async ({ projectId, userId }) => handleError(() => client.removeProjectUser(projectId, userId)),
);

server.tool(
  "update_project_user_role",
  "Update a user's role within a project.",
  {
    projectId: z.string().describe("Project ID"),
    userId: z.string().describe("User ID"),
    role: z.string().describe("New role (e.g. 'project:admin', 'project:editor', 'project:viewer')"),
  },
  async ({ projectId, userId, role }) => handleError(() => client.updateProjectUserRole(projectId, userId, role)),
);

// ── Source Control tools ────────────────────────────────────────────

server.tool(
  "source_control_pull",
  "Pull changes from the remote source control repository. Requires Source Control to be configured.",
  {
    force: z.boolean().optional().describe("Force pull, overwriting local changes"),
    autoPublish: z.string().optional().describe("Auto-publish after import: 'none' (default), 'all', or 'published'"),
    variables: z.record(z.string(), z.string()).optional().describe("Variables to set during import"),
  },
  async (params) => handleError(() => client.sourceControlPull(params as { force?: boolean; autoPublish?: string; variables?: Record<string, string> })),
);

// ── Discover tool ───────────────────────────────────────────────────

server.tool(
  "discover",
  "Discover available API capabilities based on the current API key's scopes. Returns resources, endpoints, and operations accessible to this key.",
  {
    include: z.string().optional().describe("Include additional data. Use 'schemas' to inline request body schemas"),
    resource: z.string().optional().describe("Filter to a specific resource (e.g. 'workflow', 'tags', 'credential')"),
    operation: z.string().optional().describe("Filter to a specific operation (e.g. 'read', 'create', 'list')"),
  },
  async (params) => handleError(() => client.discover(params)),
);

// ── Audit tool ──────────────────────────────────────────────────────

server.tool(
  "generate_audit",
  "Run a security audit on the n8n instance and return the findings.",
  {},
  async () => handleError(() => client.generateAudit()),
);

// ── Data Table tools ────────────────────────────────────────────────

server.tool(
  "list_data_tables",
  "List all data tables with optional filtering and sorting.",
  {
    limit: z.number().optional().describe("Max results per page (default 100, max 250)"),
    cursor: z.string().optional().describe("Pagination cursor"),
    filter: z.string().optional().describe("JSON string of filter conditions"),
    sortBy: z.string().optional().describe("Sort format: field:asc or field:desc"),
  },
  async (params) => handleError(() => client.listDataTables(params)),
);

server.tool(
  "create_data_table",
  "Create a new data table with defined columns.",
  {
    name: z.string().describe("Table name"),
    columns: z.array(z.object({
      name: z.string().describe("Column name"),
      type: z.string().describe("Column type: string, number, boolean, date, or json"),
    })).describe("Column definitions"),
  },
  async (params) => handleError(() => client.createDataTable(params)),
);

server.tool(
  "update_data_table",
  "Rename a data table.",
  {
    id: z.string().describe("Data table ID"),
    name: z.string().describe("New table name"),
  },
  async ({ id, name }) => handleError(() => client.updateDataTable(id, name)),
);

server.tool(
  "delete_data_table",
  "Delete a data table and all its rows.",
  {
    id: z.string().describe("Data table ID to delete"),
  },
  async ({ id }) => handleError(() => client.deleteDataTable(id)),
);

server.tool(
  "get_data_table_rows",
  "Query and retrieve rows from a data table with optional filtering, sorting, search, and pagination.",
  {
    dataTableId: z.string().describe("Data table ID"),
    limit: z.number().optional().describe("Max results per page (default 100, max 250)"),
    cursor: z.string().optional().describe("Pagination cursor"),
    filter: z.string().optional().describe("JSON filter: {type:'and'|'or', filters:[{columnName,condition,value}]}. Conditions: eq, neq, like, ilike, gt, gte, lt, lte"),
    sortBy: z.string().optional().describe("Sort format: columnName:asc or columnName:desc"),
    search: z.string().optional().describe("Search text across all string columns"),
  },
  async ({ dataTableId, ...opts }) => handleError(() => client.getDataTableRows(dataTableId, opts)),
);

server.tool(
  "insert_data_table_rows",
  "Insert one or more rows into a data table.",
  {
    dataTableId: z.string().describe("Data table ID"),
    data: z.array(z.record(z.string(), z.unknown())).describe("Array of row objects with column names as keys"),
    returnType: z.string().optional().describe("What to return: 'count' (default), 'id' (array of IDs), or 'all' (full row data)"),
  },
  async ({ dataTableId, data, returnType }) => handleError(() => client.insertDataTableRows(dataTableId, data, returnType)),
);

server.tool(
  "update_data_table_rows",
  "Update rows matching filter conditions in a data table.",
  {
    dataTableId: z.string().describe("Data table ID"),
    filter: z.record(z.string(), z.unknown()).describe("Filter object: {type:'and'|'or', filters:[{columnName,condition,value}]}"),
    data: z.record(z.string(), z.unknown()).describe("Column values to update"),
    returnData: z.boolean().optional().describe("Return the updated rows (default false)"),
    dryRun: z.boolean().optional().describe("Preview changes without persisting (default false)"),
  },
  async ({ dataTableId, filter, data, ...opts }) => handleError(() => client.updateDataTableRows(dataTableId, filter, data, opts)),
);

server.tool(
  "delete_data_table_rows",
  "Delete rows matching filter conditions from a data table.",
  {
    dataTableId: z.string().describe("Data table ID"),
    filter: z.string().describe("JSON string of filter conditions (required to prevent accidental deletion of all data)"),
    returnData: z.boolean().optional().describe("Return the deleted rows (default false)"),
    dryRun: z.boolean().optional().describe("Preview which rows would be deleted without deleting (default false)"),
  },
  async ({ dataTableId, filter, ...opts }) => handleError(() => client.deleteDataTableRows(dataTableId, filter, opts)),
);

server.tool(
  "upsert_data_table_row",
  "Update a row if it matches filter conditions, or insert a new one if no match is found.",
  {
    dataTableId: z.string().describe("Data table ID"),
    filter: z.record(z.string(), z.unknown()).describe("Filter object: {type:'and'|'or', filters:[{columnName,condition,value}]}"),
    data: z.record(z.string(), z.unknown()).describe("Column values for the row"),
    returnData: z.boolean().optional().describe("Return the upserted row (default false)"),
    dryRun: z.boolean().optional().describe("Preview changes without persisting (default false)"),
  },
  async ({ dataTableId, filter, data, ...opts }) => handleError(() => client.upsertDataTableRow(dataTableId, filter, data, opts)),
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
