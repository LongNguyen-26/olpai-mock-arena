/** Atomic quota grant bound to a run and request, without resetting per-team counters. */
// Timing helpers accept omitted null fields from the provider's cjson serializer.
import { ROUND_POLICY_LUA } from "./round-policy-lua";
export const GRANT_QUOTA_SCRIPT =
  ROUND_POLICY_LUA +
  `
local cached=redis.call('GET',KEYS[2]);if cached then if cached==ARGV[4] then return 'ok' else return 'nonce' end end
local now=arena_now();local c=arena_round(KEYS[1],now);if not c or c.id~=ARGV[1] then return 'run' end
local phase=arena_phase(c,now);if phase~='public' and phase~='private' and phase~='practice' then return 'closed' end
local field='publicLimit';if ARGV[2]=='private' then field='privateLimit' end
local limit=c[field]+tonumber(ARGV[3]);if limit>1000 then return 'limit' end
c[field]=limit;c.revision=(c.revision or 0)+1
redis.call('SET',KEYS[1],cjson.encode(c));redis.call('SET',KEYS[2],ARGV[4],'EX',604800);return 'ok'
`;
