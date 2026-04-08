/**
 * Lightweight n8n REST API client.
 * All methods return the parsed JSON response or throw on HTTP errors.
 */
export class N8nClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  // ── Generic request helper ────────────────────────────────────────

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      "X-N8N-API-KEY": this.apiKey,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`n8n API ${method} ${path} → ${res.status}: ${text}`);
    }

    // Handle 204 No Content
    if (res.status === 204) {
      return { success: true } as unknown as T;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  // ── Workflows ─────────────────────────────────────────────────────

  async listWorkflows(opts?: { limit?: number; cursor?: string; tags?: string; name?: string; active?: boolean; projectId?: string }) {
    return this.request("GET", "/workflows", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async getWorkflow(id: string) {
    return this.request("GET", `/workflows/${encodeURIComponent(id)}`);
  }

  async createWorkflow(body: { name: string; nodes: unknown[]; connections: unknown; settings: unknown }) {
    return this.request("POST", "/workflows", body);
  }

  async updateWorkflow(id: string, body: { name: string; nodes: unknown[]; connections: unknown; settings: unknown }) {
    return this.request("PUT", `/workflows/${encodeURIComponent(id)}`, body);
  }

  async deleteWorkflow(id: string) {
    return this.request("DELETE", `/workflows/${encodeURIComponent(id)}`);
  }

  async activateWorkflow(id: string) {
    return this.request("POST", `/workflows/${encodeURIComponent(id)}/activate`);
  }

  async deactivateWorkflow(id: string) {
    return this.request("POST", `/workflows/${encodeURIComponent(id)}/deactivate`);
  }

  async getWorkflowTags(id: string) {
    return this.request("GET", `/workflows/${encodeURIComponent(id)}/tags`);
  }

  async updateWorkflowTags(id: string, tagIds: Array<{ id: string }>) {
    return this.request("PUT", `/workflows/${encodeURIComponent(id)}/tags`, tagIds);
  }

  async transferWorkflow(id: string, destinationProjectId: string) {
    return this.request("PUT", `/workflows/${encodeURIComponent(id)}/transfer`, { destinationProjectId });
  }

  // ── Executions ────────────────────────────────────────────────────

  async listExecutions(opts?: {
    limit?: number;
    cursor?: string;
    status?: string;
    workflowId?: string;
    projectId?: string;
    includeData?: boolean;
    startedAfter?: string;
    startedBefore?: string;
  }) {
    const { startedAfter, startedBefore, ...apiOpts } = opts ?? {};
    const needsDateFilter = startedAfter || startedBefore;

    if (!needsDateFilter) {
      return this.request("GET", "/executions", undefined, apiOpts as Record<string, string | number | boolean | undefined>);
    }

    // n8n API doesn't support date filtering, so we paginate and filter client-side.
    // Executions are returned newest-first, so we stop once we pass startedAfter.
    const afterTs = startedAfter ? new Date(startedAfter).getTime() : 0;
    const beforeTs = startedBefore ? new Date(startedBefore).getTime() : Infinity;
    const maxResults = apiOpts.limit ?? 100;
    const filtered: unknown[] = [];
    let cursor = apiOpts.cursor as string | undefined;

    while (filtered.length < maxResults) {
      const pageSize = Math.min(250, maxResults - filtered.length + 50); // fetch extra to account for filtering
      const page = await this.request<{ data: Array<{ startedAt?: string; [k: string]: unknown }>; nextCursor?: string }>(
        "GET", "/executions", undefined,
        { ...apiOpts, limit: pageSize, cursor } as Record<string, string | number | boolean | undefined>,
      );

      let pastRange = false;
      for (const exec of page.data) {
        const ts = exec.startedAt ? new Date(exec.startedAt).getTime() : 0;
        if (ts < afterTs) { pastRange = true; break; }
        if (ts <= beforeTs) filtered.push(exec);
      }

      if (pastRange || !page.nextCursor || filtered.length >= maxResults) break;
      cursor = page.nextCursor;
    }

    return { data: filtered.slice(0, maxResults), totalFiltered: filtered.length };
  }

  async getExecution(id: string, opts?: {
    includeData?: boolean;
    nodeNames?: string[];
    truncateData?: boolean;
  }) {
    const { includeData, nodeNames, truncateData } = opts ?? {};
    const result = await this.request<Record<string, unknown>>(
      "GET", `/executions/${encodeURIComponent(id)}`,
      undefined,
      { includeData },
    );

    // Client-side filtering when includeData is true
    if (includeData && result.data && typeof result.data === "object") {
      const data = result.data as Record<string, unknown>;
      const resultData = data.resultData as Record<string, unknown> | undefined;
      const runData = resultData?.runData as Record<string, unknown[]> | undefined;

      if (runData) {
        // Filter to specific nodes if requested
        if (nodeNames && nodeNames.length > 0) {
          const nameSet = new Set(nodeNames);
          for (const key of Object.keys(runData)) {
            if (!nameSet.has(key)) delete runData[key];
          }
        }

        // Truncate items per node to prevent context overflow
        if (truncateData) {
          const MAX_ITEMS_PER_NODE = 5;
          for (const [, runs] of Object.entries(runData)) {
            if (!Array.isArray(runs)) continue;
            for (const run of runs as Array<Record<string, unknown>>) {
              const nodeData = run.data as Record<string, Record<string, unknown[]>> | undefined;
              if (!nodeData) continue;
              for (const connType of Object.keys(nodeData)) {
                const outputs = nodeData[connType];
                if (!Array.isArray(outputs)) continue;
                for (let i = 0; i < outputs.length; i++) {
                  const items = outputs[i];
                  if (Array.isArray(items) && items.length > MAX_ITEMS_PER_NODE) {
                    const total = items.length;
                    outputs[i] = items.slice(0, MAX_ITEMS_PER_NODE);
                    (outputs[i] as unknown[]).push({ __truncated: true, totalItems: total, showing: MAX_ITEMS_PER_NODE });
                  }
                }
              }
            }
          }
        }
      }
    }

    return result;
  }

  async getExecutionTags(id: string) {
    return this.request("GET", `/executions/${encodeURIComponent(id)}/tags`);
  }

  async deleteExecution(id: string) {
    return this.request("DELETE", `/executions/${encodeURIComponent(id)}`);
  }

  async retryExecution(id: string) {
    return this.request("POST", `/executions/${encodeURIComponent(id)}/retry`);
  }

  async stopExecution(id: string) {
    return this.request("POST", `/executions/${encodeURIComponent(id)}/stop`);
  }

  // ── Credentials ───────────────────────────────────────────────────

  async listCredentials(opts?: { limit?: number; cursor?: string }) {
    return this.request("GET", "/credentials", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async createCredential(body: { name: string; type: string; data: Record<string, unknown> }) {
    return this.request("POST", "/credentials", body);
  }

  async updateCredential(id: string, body: { name?: string; type?: string; data?: Record<string, unknown> }) {
    return this.request("PATCH", `/credentials/${encodeURIComponent(id)}`, body);
  }

  async deleteCredential(id: string) {
    return this.request("DELETE", `/credentials/${encodeURIComponent(id)}`);
  }

  async transferCredential(id: string, destinationProjectId: string) {
    return this.request("PUT", `/credentials/${encodeURIComponent(id)}/transfer`, { destinationProjectId });
  }

  async getCredentialSchema(typeName: string) {
    return this.request("GET", `/credentials/schema/${encodeURIComponent(typeName)}`);
  }

  // ── Tags ──────────────────────────────────────────────────────────

  async listTags(opts?: { limit?: number; cursor?: string }) {
    return this.request("GET", "/tags", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async createTag(name: string) {
    return this.request("POST", "/tags", { name });
  }

  async updateTag(id: string, name: string) {
    return this.request("PUT", `/tags/${encodeURIComponent(id)}`, { name });
  }

  async deleteTag(id: string) {
    return this.request("DELETE", `/tags/${encodeURIComponent(id)}`);
  }

  // ── Users ─────────────────────────────────────────────────────────

  async listUsers(opts?: { limit?: number; cursor?: string; includeRole?: boolean; projectId?: string }) {
    return this.request("GET", "/users", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async getUser(id: string) {
    return this.request("GET", `/users/${encodeURIComponent(id)}`);
  }

  // ── Variables ─────────────────────────────────────────────────────

  async listVariables(opts?: { limit?: number; cursor?: string; projectId?: string; state?: string }) {
    return this.request("GET", "/variables", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async createVariable(body: { key: string; value: string; projectId?: string }) {
    return this.request("POST", "/variables", body);
  }

  async deleteVariable(id: string) {
    return this.request("DELETE", `/variables/${encodeURIComponent(id)}`);
  }

  // ── Projects ──────────────────────────────────────────────────────

  async listProjects(opts?: { limit?: number; cursor?: string }) {
    return this.request("GET", "/projects", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async getProject(id: string) {
    return this.request("GET", `/projects/${encodeURIComponent(id)}`);
  }

  async createProject(name: string) {
    return this.request("POST", "/projects", { name });
  }

  async updateProject(id: string, name: string) {
    return this.request("PUT", `/projects/${encodeURIComponent(id)}`, { name });
  }

  async deleteProject(id: string) {
    return this.request("DELETE", `/projects/${encodeURIComponent(id)}`);
  }

  async listProjectUsers(id: string, opts?: { limit?: number; cursor?: string }) {
    return this.request("GET", `/projects/${encodeURIComponent(id)}/users`, undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async addProjectUsers(id: string, relations: Array<{ userId: string; role: string }>) {
    return this.request("POST", `/projects/${encodeURIComponent(id)}/users`, { relations });
  }

  async removeProjectUser(projectId: string, userId: string) {
    return this.request("DELETE", `/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(userId)}`);
  }

  async updateProjectUserRole(projectId: string, userId: string, role: string) {
    return this.request("PATCH", `/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(userId)}`, { role });
  }

  // ── Source Control ────────────────────────────────────────────────

  async sourceControlPull(opts?: { force?: boolean; autoPublish?: string; variables?: Record<string, string> }) {
    return this.request("POST", "/source-control/pull", opts ?? {});
  }

  // ── Discover ──────────────────────────────────────────────────────

  async discover(opts?: { include?: string; resource?: string; operation?: string }) {
    return this.request("GET", "/discover", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  // ── Audit ─────────────────────────────────────────────────────────

  async generateAudit() {
    return this.request("POST", "/audit");
  }

  // ── Data Tables ───────────────────────────────────────────────────

  async listDataTables(opts?: { limit?: number; cursor?: string; filter?: string; sortBy?: string }) {
    return this.request("GET", "/data-tables", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async createDataTable(body: { name: string; columns: Array<{ name: string; type: string }> }) {
    return this.request("POST", "/data-tables", body);
  }

  async updateDataTable(id: string, name: string) {
    return this.request("PATCH", `/data-tables/${encodeURIComponent(id)}`, { name });
  }

  async deleteDataTable(id: string) {
    return this.request("DELETE", `/data-tables/${encodeURIComponent(id)}`);
  }

  async getDataTableRows(id: string, opts?: { limit?: number; cursor?: string; filter?: string; sortBy?: string; search?: string }) {
    return this.request("GET", `/data-tables/${encodeURIComponent(id)}/rows`, undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async insertDataTableRows(id: string, data: Array<Record<string, unknown>>, returnType?: string) {
    return this.request("POST", `/data-tables/${encodeURIComponent(id)}/rows`, { data, returnType });
  }

  async updateDataTableRows(id: string, filter: unknown, data: Record<string, unknown>, opts?: { returnData?: boolean; dryRun?: boolean }) {
    return this.request("PATCH", `/data-tables/${encodeURIComponent(id)}/rows/update`, { filter, data, ...opts });
  }

  async deleteDataTableRows(id: string, filter: string, opts?: { returnData?: boolean; dryRun?: boolean }) {
    return this.request("DELETE", `/data-tables/${encodeURIComponent(id)}/rows/delete`, undefined, { filter, ...opts } as Record<string, string | number | boolean | undefined>);
  }

  async upsertDataTableRow(id: string, filter: unknown, data: Record<string, unknown>, opts?: { returnData?: boolean; dryRun?: boolean }) {
    return this.request("POST", `/data-tables/${encodeURIComponent(id)}/rows/upsert`, { filter, data, ...opts });
  }
}
