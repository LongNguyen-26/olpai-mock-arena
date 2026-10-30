import type { WorkspaceTemplate } from "./workspace-domain";
import {
  podStartupFailure,
  podStartupProgress,
  type PodStartupFailure,
  type PodStartupDiagnostic,
} from "./runpod-startup";
// The image uses CUDA 12.8. Use the scheduler's minimum rather than a frozen
// REST v1 enum, which excludes otherwise compatible hosts advertising 13.2.
export const WORKSPACE_MIN_CUDA = "12.8";
const diagnosticFields = new Set([
  "allowedCudaVersions",
  "gpuTypeIds",
  "gpuCount",
  "cloudType",
  "computeType",
  "imageName",
  "minRAMPerGPU",
  "minVCPUPerGPU",
  "containerDiskInGb",
  "volumeInGb",
  "ports",
]);
function invalidRequestFields(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const body = value as Record<string, unknown>;
  const issues = [body.errors, body.details, body.issues].flatMap((v) =>
    Array.isArray(v) ? v : [],
  );
  return [
    ...new Set(
      issues.flatMap((issue) => {
        if (!issue || typeof issue !== "object") return [];
        const path = (issue as Record<string, unknown>).path;
        const field = Array.isArray(path)
          ? path[0]
          : typeof path === "string"
            ? path.split(/[.[\]]/)[0]
            : null;
        return typeof field === "string" && diagnosticFields.has(field)
          ? [field]
          : [];
      }),
    ),
  ];
}
export interface RunpodPod {
  imageName?: string;
  id: string;
  name: string;
  desiredStatus: string;
  costPerHr?: number;
  runtime?: { uptimeInSeconds: number } | null;
}
export interface GpuPrice {
  id: string;
  name: string;
  memory: number;
  price: { secure: number | null; community: number | null };
  availability?: string;
}
export class RunpodError extends Error {
  constructor(
    public status: number,
    public uncertain = false,
    invalidFields: string[] = [],
    public reason?: "capacity" | "balance",
  ) {
    super(
      reason === "capacity"
        ? "Runpod hiện không có GPU trống đáp ứng cấu hình/cloud đã chọn. Hãy đổi cloud hoặc tài nguyên rồi cấp lại."
        : reason === "balance"
          ? "Số dư Runpod không đủ để cấp Pod. Kiểm tra Billing trên Runpod."
          : status === 401 || status === 403
            ? "Runpod từ chối API key hoặc quyền truy cập."
            : status === 400 && invalidFields.length
              ? `Runpod từ chối cấu hình Pod (HTTP 400). Trường không hợp lệ: ${invalidFields.join(", ")}.`
              : `Runpod chưa thực hiện được yêu cầu (HTTP ${status}).`,
    );
  }
}
export class Runpod {
  constructor(
    private apiKey: string,
    private transport: typeof fetch = fetch,
  ) {}
  private async request<T>(
    url: string,
    method = "GET",
    body?: unknown,
    mutation = method !== "GET",
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
        redirect: "error",
      });
    } catch {
      throw new RunpodError(504, mutation);
    }
    if (!response.ok) {
      // Expose only allowlisted field names, never provider text, env or credentials.
      const fields =
        response.status === 400
          ? invalidRequestFields(await response.json().catch(() => null))
          : [];
      throw new RunpodError(
        response.status,
        mutation && (response.status >= 500 || response.status === 408),
        fields,
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch {
      throw new RunpodError(502, mutation);
    }
  }
  private async graphql<T>(
    query: string,
    variables: object,
    field: string,
    mutation = false,
  ): Promise<T> {
    const result = await this.request<{
      data?: Record<string, T | null>;
      errors?: { message?: string; extensions?: { code?: string } }[];
    }>("https://api.runpod.io/graphql", "POST", { query, variables }, mutation);
    // Only request safe Pod fields. Never return/log env or raw GraphQL errors.
    if (
      result?.data &&
      Object.hasOwn(result.data, field) &&
      (result.data[field] != null ||
        (field === "podTerminate" && !result.errors?.length))
    )
      return result.data[field] as T;
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    const messages = errors
      .map((e) => (typeof e.message === "string" ? e.message : ""))
      .join(" ");
    const codes = errors.map((e) => e.extensions?.code);
    const capacity =
      codes.includes("SUPPLY_CONSTRAINT") ||
      /no (?:longer any )?(?:instances|gpus?|resources|machines)(?:\s+are)? available|could not find.*(?:instance|gpu|machine)|no available (?:instances|gpus?|machines)|out of stock/i.test(
        messages,
      );
    const balance =
      /insufficient (?:funds|balance|credit)|not enough (?:funds|balance|credit)/i.test(
        messages,
      );
    const invalid = codes.some((code) =>
      [
        "GRAPHQL_PARSE_FAILED",
        "GRAPHQL_VALIDATION_FAILED",
        "BAD_USER_INPUT",
      ].includes(code ?? ""),
    );
    const denied = codes.some((code) =>
      ["UNAUTHENTICATED", "FORBIDDEN"].includes(code ?? ""),
    );
    throw new RunpodError(
      denied ? 403 : capacity || balance || invalid ? 400 : 502,
      mutation && !capacity && !balance && !invalid && !denied,
      [],
      capacity ? "capacity" : balance ? "balance" : undefined,
    );
  }
  async list() {
    const result = await this.graphql<{ pods: RunpodPod[] }>(
      "query ArenaPods { myself { pods { id name desiredStatus costPerHr runtime { uptimeInSeconds } } } }",
      {},
      "myself",
    );
    if (!Array.isArray(result.pods)) throw new RunpodError(502);
    return result.pods;
  }
  async get(id: string) {
    // Listing also distinguishes an absent Pod from a failed GraphQL query.
    const pod = (await this.list()).find((p) => p.id === id);
    if (!pod) throw new RunpodError(404);
    return pod;
  }
  async inspect(id: string) {
    // Only allowlisted metadata; never request or expose provider environment.
    const result = await this.graphql<{ pods: RunpodPod[] }>(
      "query ArenaInspect { myself { pods { id name imageName desiredStatus costPerHr runtime { uptimeInSeconds } } } }",
      {},
      "myself",
    );
    if (!Array.isArray(result.pods)) throw new RunpodError(502);
    const pod = result.pods.find((p) => p.id === id);
    if (!pod) throw new RunpodError(404);
    return pod;
  }
  async startupFailure(id: string): Promise<PodStartupFailure | null> {
    return (await this.startupDiagnostic(id)).failure;
  }
  async startupDiagnostic(id: string): Promise<PodStartupDiagnostic> {
    // This is a live SSE stream, not a JSON response. Bound time and bytes even
    // when the provider never closes it. Read system logs only, server-side.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let pending = "",
      bytes = 0,
      lines = 0;
    const diagnostic: PodStartupDiagnostic = { failure: null, progress: null };
    try {
      const response = await this.transport(
        `https://api.runpod.io/v2/pods/${encodeURIComponent(id)}/logs?source=system&tail=20`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "text/event-stream",
          },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) return diagnostic;
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (bytes < 32768 && lines < 20) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value.subarray(0, 32768 - bytes), {
          stream: true,
        });
        bytes += value.byteLength;
        let end: number;
        while (lines < 20 && (end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end).trim();
          pending = pending.slice(end + 1);
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5));
            if (event.source !== "system" || typeof event.line !== "string")
              continue;
            lines++;
            const classified = podStartupFailure(event.line);
            if (classified) diagnostic.failure = classified;
            if (classified === "gpu-reset") return diagnostic;
            const progress = podStartupProgress(event.line);
            if (progress) diagnostic.progress = progress;
          } catch {
            /* Ignore malformed events without exposing their contents. */
          }
        }
      }
      return diagnostic;
    } catch {
      // Missing log permission or a transient outage is not proof of Pod failure.
      return diagnostic;
    } finally {
      clearTimeout(timer);
      controller.abort();
      await reader?.cancel().catch(() => {});
    }
  }
  create(name: string, t: WorkspaceTemplate, env: Record<string, string>) {
    // Same operation as the Python GraphQL SDK. Never fall back/retry a mutation
    // after a timeout: it may have created a billable Pod despite a lost reply.
    return this.graphql<RunpodPod>(
      "mutation ArenaCreate($input: PodFindAndDeployOnDemandInput!) { podFindAndDeployOnDemand(input: $input) { id name desiredStatus costPerHr } }",
      {
        input: {
          name,
          imageName: t.imageName,
          cloudType: t.cloudType,
          computeType: "GPU",
          gpuCount: 1,
          minCudaVersion: WORKSPACE_MIN_CUDA,
          gpuTypeId: t.gpuTypeId,
          minMemoryInGb: t.minRAMPerGPU,
          minVcpuCount: t.minVCPUPerGPU,
          containerDiskInGb: t.containerDiskInGb,
          volumeInGb: t.volumeInGb,
          volumeMountPath: "/workspace",
          ports:
            env.ARENA_WORKSPACE_SERVICES === "llm"
              ? "8000/http"
              : "8888/http,8000/http",
          startSsh: false,
          startJupyter: false,
          env: Object.entries(env).map(([key, value]) => ({ key, value })),
        },
      },
      "podFindAndDeployOnDemand",
      true,
    );
  }
  stop(id: string) {
    return this.graphql<unknown>(
      "mutation ArenaStop($input: PodStopInput!) { podStop(input: $input) { id desiredStatus } }",
      { input: { podId: id } },
      "podStop",
      true,
    );
  }
  start(id: string) {
    return this.graphql<unknown>(
      "mutation ArenaResume($input: PodResumeInput!) { podResume(input: $input) { id desiredStatus } }",
      { input: { podId: id, gpuCount: 1 } },
      "podResume",
      true,
    );
  }
  terminate(id: string) {
    return this.graphql<unknown>(
      "mutation ArenaTerminate($input: PodTerminateInput!) { podTerminate(input: $input) }",
      { input: { podId: id } },
      "podTerminate",
      true,
    );
  }
  async prices() {
    const result = await this.request<{ gpus: GpuPrice[] }>(
      "https://api.runpod.io/v2/catalog/gpus",
    );
    return result.gpus;
  }
  async resources(
    gpuTypeId: string,
    cloudType: WorkspaceTemplate["cloudType"],
  ) {
    const result = await this.graphql<
      {
        id: string;
        lowestPrice: {
          minMemory: number;
          minVcpu: number;
          stockStatus?: string;
        } | null;
      }[]
    >(
      "query ArenaGpuResources($gpu: GpuTypeFilter, $offer: GpuLowestPriceInput) { gpuTypes(input: $gpu) { id lowestPrice(input: $offer) { minMemory minVcpu stockStatus } } }",
      {
        gpu: { id: gpuTypeId },
        offer: {
          gpuCount: 1,
          ...(cloudType === "ALL"
            ? {}
            : { secureCloud: cloudType === "SECURE" }),
          minCudaVersion: WORKSPACE_MIN_CUDA,
        },
      },
      "gpuTypes",
    );
    const offer = result.find((g) => g.id === gpuTypeId)?.lowestPrice;
    if (
      !offer ||
      !Number.isInteger(offer.minMemory) ||
      !Number.isInteger(offer.minVcpu) ||
      offer.minMemory < 1 ||
      offer.minVcpu < 1
    )
      return {
        minRAMPerGPU: null,
        minVCPUPerGPU: null,
        stockStatus: offer?.stockStatus ?? null,
      };
    return {
      minRAMPerGPU: offer.minMemory,
      minVCPUPerGPU: offer.minVcpu,
      stockStatus: offer.stockStatus ?? null,
    };
  }
}
export const podOrigin = (id: string, port: 8000 | 8888) => {
  if (!/^[a-zA-Z0-9]{5,64}$/.test(id)) throw new Error("Pod ID không hợp lệ.");
  return `https://${id}-${port}.proxy.runpod.net`;
};
