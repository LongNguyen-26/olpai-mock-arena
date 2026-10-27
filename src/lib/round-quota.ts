/** Atomic quota grant bound to a run and request, without resetting per-team counters. */
// Patch the integer in the original JSON: the provider's cjson round-trip can
// omit null time fields, which would change phase calculations in JavaScript.
export const GRANT_QUOTA_SCRIPT = `
local cached=redis.call('GET',KEYS[2]);if cached then if cached==ARGV[4] then return 'ok' else return 'nonce' end end
local raw=redis.call('GET',KEYS[1]);if not raw then return 'run' end
local c=cjson.decode(raw);if c.id~=ARGV[1] then return 'run' end
local tm=redis.call('TIME');local now=tonumber(tm[1])*1000+math.floor(tonumber(tm[2])/1000)
if c.startAt==cjson.null or now<c.startAt then return 'closed' end
if c.forcedEndAt~=cjson.null and now>=c.forcedEndAt then return 'closed' end
local p=c.privateAt;if p==nil or p==cjson.null then if c.unlimited then p=nil else p=c.startAt+c.publicSeconds*1000 end end
if p~=nil and not c.unlimited and now>=p+c.privateSeconds*1000 then return 'closed' end
local field='publicLimit';if ARGV[2]=='private' then field='privateLimit' end
local limit=c[field]+tonumber(ARGV[3]);if limit>1000 then return 'limit' end
local updated,n=string.gsub(raw,'"'..field..'"%s*:%s*%d+','"'..field..'":'..tostring(limit),1)
if n~=1 then return 'run' end
redis.call('SET',KEYS[1],updated);redis.call('SET',KEYS[2],ARGV[4],'EX',604800);return 'ok'
`;
