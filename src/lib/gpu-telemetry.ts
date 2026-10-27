export function gpuTelemetry(raw?: string) {
  if (!raw) return null;
  const line = raw.split("\n")[0];
  const fields = line.split(",").map((s) => s.trim());
  if (fields.length >= 4) {
    const number = (text: string) => {
      const n = Number.parseFloat(text);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const used = number(fields[1]),
      total = number(fields[2]),
      utilization = number(fields[3]);
    return {
      name: fields[0],
      usedMiB: used,
      totalMiB: total,
      utilization,
      temperature: fields[4] ? number(fields[4]) : null,
    };
  }
  const memory = raw.match(/VRAM:\s*([\d.]+)\s*\/\s*([\d.]+)\s*GB/i);
  const utilization = raw.match(/GPU:\s*([\d.]+)\s*%/i);
  const temperature = raw.match(/(?:Nhiệt độ|Temperature):\s*([\d.]+)/i);
  return {
    name: line,
    usedMiB: memory ? Number(memory[1]) * 1024 : null,
    totalMiB: memory ? Number(memory[2]) * 1024 : null,
    utilization: utilization ? Number(utilization[1]) : null,
    temperature: temperature ? Number(temperature[1]) : null,
  };
}
