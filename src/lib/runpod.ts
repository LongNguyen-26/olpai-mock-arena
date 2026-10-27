import type { WorkspaceTemplate } from "./workspace-domain";
export interface RunpodPod {
  id: string;
  name: string;
  desiredStatus: string;
  costPerHr?: number;
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
  ) {
    super(
      status === 401 || status === 403
        ? "Runpod từ chối API key hoặc quyền truy cập."
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
    path: string,
    method = "GET",
    body?: unknown,
    catalog = false,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(
        `${catalog ? "https://api.runpod.io/v2" : "https://rest.runpod.io/v1"}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: "no-store",
          signal: AbortSignal.timeout(45000),
          redirect: "error",
        },
      );
    } catch {
      throw new RunpodError(504, method !== "GET");
    }
    if (!response.ok)
      throw new RunpodError(
        response.status,
        method !== "GET" && (response.status >= 500 || response.status === 408),
      );
    if (response.status === 204) return undefined as T;
    try {
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch {
      throw new RunpodError(502, method !== "GET");
    }
  }
  list() {
    return this.request<RunpodPod[]>("/pods");
  }
  get(id: string) {
    return this.request<RunpodPod>(`/pods/${encodeURIComponent(id)}`);
  }
  create(name: string, t: WorkspaceTemplate, env: Record<string, string>) {
    // Deliberately no retry: a timeout can still mean that a billable Pod was created.
    return this.request<RunpodPod>("/pods", "POST", {
      name,
      imageName: t.imageName,
      cloudType: t.cloudType,
      computeType: "GPU",
      gpuCount: 1,
      allowedCudaVersions: ["12.8", "12.9", "13.0", "13.1", "13.2"],
      gpuTypeIds: [t.gpuTypeId],
      interruptible: false,
      minRAMPerGPU: t.minRAMPerGPU,
      minVCPUPerGPU: t.minVCPUPerGPU,
      containerDiskInGb: t.containerDiskInGb,
      volumeInGb: t.volumeInGb,
      volumeMountPath: "/workspace",
      ports: ["8888/http", "8000/http"],
      env,
    });
  }
  stop(id: string) {
    return this.request<unknown>(
      `/pods/${encodeURIComponent(id)}/stop`,
      "POST",
    );
  }
  start(id: string) {
    return this.request<unknown>(
      `/pods/${encodeURIComponent(id)}/start`,
      "POST",
    );
  }
  terminate(id: string) {
    return this.request<unknown>(`/pods/${encodeURIComponent(id)}`, "DELETE");
  }
  async prices() {
    const result = await this.request<{ gpus: GpuPrice[] }>(
      "/catalog/gpus",
      "GET",
      undefined,
      true,
    );
    return result.gpus;
  }
}
export const podOrigin = (id: string, port: 8000 | 8888) => {
  if (!/^[a-zA-Z0-9]{5,64}$/.test(id)) throw new Error("Pod ID không hợp lệ.");
  return `https://${id}-${port}.proxy.runpod.net`;
};
