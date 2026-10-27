import assert from "node:assert/strict";
import test from "node:test";
import { gpuTelemetry } from "../src/lib/gpu-telemetry";

test("legacy Pod telemetry retains named units", () => {
  assert.deepEqual(gpuTelemetry("NVIDIA A40, 19687 MiB, 46068 MiB, 97 %"), {
    name: "NVIDIA A40",
    usedMiB: 19687,
    totalMiB: 46068,
    utilization: 97,
    temperature: null,
  });
});
test("new Pod telemetry includes temperature and ignores unavailable fields", () => {
  assert.deepEqual(
    gpuTelemetry("NVIDIA A40, 0, 46068, 0, 42\nSecond GPU, 1, 2, 3, 4"),
    {
      name: "NVIDIA A40",
      usedMiB: 0,
      totalMiB: 46068,
      utilization: 0,
      temperature: 42,
    },
  );
  assert.equal(
    gpuTelemetry("NVIDIA A40, N/A, 46068, [Not Supported]")?.usedMiB,
    null,
  );
  assert.equal(
    gpuTelemetry("NVIDIA A40, N/A, 46068, [Not Supported]")?.utilization,
    null,
  );
  assert.equal(gpuTelemetry(undefined), null);
});
