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

  async activateWorkflow(id: string) {
    return this.request("POST", `/workflows/${encodeURIComponent(id)}/activate`);
  }

  async deactivateWorkflow(id: string) {
    return this.request("POST", `/workflows/${encodeURIComponent(id)}/deactivate`);
  }

  async getWorkflowTags(id: string) {
    return this.request("GET", `/workflows/${encodeURIComponent(id)}/tags`);
  }

  // ── Executions ────────────────────────────────────────────────────

  async listExecutions(opts?: {
    limit?: number;
    cursor?: string;
    status?: string;
    workflowId?: string;
    projectId?: string;
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

  async getExecution(id: string) {
    return this.request("GET", `/executions/${encodeURIComponent(id)}`);
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

  async getCredentialSchema(typeName: string) {
    return this.request("GET", `/credentials/schema/${encodeURIComponent(typeName)}`);
  }

  // ── Tags ──────────────────────────────────────────────────────────

  async listTags(opts?: { limit?: number; cursor?: string }) {
    return this.request("GET", "/tags", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  // ── Users ─────────────────────────────────────────────────────────

  async listUsers(opts?: { limit?: number; cursor?: string; includeRole?: boolean }) {
    return this.request("GET", "/users", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async getUser(id: string) {
    return this.request("GET", `/users/${encodeURIComponent(id)}`);
  }

  // ── Variables ─────────────────────────────────────────────────────

  async listVariables(opts?: { limit?: number; cursor?: string }) {
    return this.request("GET", "/variables", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  // ── Projects ──────────────────────────────────────────────────────

  async listProjects(opts?: { limit?: number; cursor?: string }) {
    return this.request("GET", "/projects", undefined, opts as Record<string, string | number | boolean | undefined>);
  }

  async getProject(id: string) {
    return this.request("GET", `/projects/${encodeURIComponent(id)}`);
  }

  // ── Audit ─────────────────────────────────────────────────────────

  async generateAudit() {
    return this.request("POST", "/audit");
  }
}
