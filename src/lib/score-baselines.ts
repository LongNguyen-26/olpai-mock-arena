import type { ContestPackage, Split } from "./types";
import type { Baselines } from "./score-display";
// Measured by the two published notebooks, specific to this immutable package.
const regional:Baselines = { public:{"1":31.429483329418336,"2":8.8}, private:{"1":30.444523344422088,"2":16} };
export function packageBaselines(pkg?:ContestPackage|null):Baselines|null {
  if (!pkg) return null;
  const values=pkg.baselineScores ?? (pkg.version==="regional-01-82a84e389db4" ? regional : null);
  return values && pkg.tasks?.length && pkg.tasks.every(t=>["public","private"].every(split=>Number.isFinite(values[split as Split]?.[t.id]))) ? values : null;
}
