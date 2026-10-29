/** Mirrors domain.ts. All authorization scripts use Redis TIME and these helpers. */
export const ROUND_POLICY_LUA = `
local function arena_value(v) if v==nil or v==cjson.null then return nil end;return v end
local function arena_now() local t=redis.call('TIME');return tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000) end
local function arena_private(c)
 local actual=arena_value(c.privateStartedAt);if actual then return actual end
 local p=arena_value(c.privateAt);if p or c.timingVersion==1 then return p end
 local start=arena_value(c.startAt);if not start or c.unlimited then return nil end;return start+c.publicSeconds*1000
end
local function arena_competition_end(c)
 local forced=arena_value(c.forcedEndAt);if forced then return forced end
 if c.timingVersion==1 then return arena_value(c.endAt) end
 local p=arena_private(c);if c.unlimited or not p then return nil end;return p+c.privateSeconds*1000
end
local function arena_phase(c,now)
 if c.practice then local e=arena_value(c.practice.endAt);if now>=c.practice.startAt and (not e or now<e) then return 'practice' end;return 'ended' end
 local start=arena_value(c.startAt);if not start then return 'waiting' end;if now<start then return 'scheduled' end
 local e=arena_competition_end(c);if e and now>=e then return 'ended' end
 local p=arena_private(c);if not p or now<p then return 'public' end;return 'private'
end
local function arena_transition(c,now)
 local p=arena_private(c);local e=arena_competition_end(c);local start=arena_value(c.startAt)
 if arena_value(c.privateStartedAt) or not p or now<p or not start or now<start or (e and p>=e) then return false end
 c.privateStartedAt=p;c.revision=(c.revision or 0)+1;c.submissionAccess=c.submissionAccess or {}
 c.submissionAccess.public=c.submissionAccess.public or {visible=true,enabled=true}
 c.submissionAccess.private=c.submissionAccess.private or {visible=true,enabled=true}
 local policy=c.privatePolicy or {lockPublic=true,revokeChatbot=true}
 if policy.lockPublic then c.submissionAccess.public.enabled=false end
 if policy.revokeChatbot then c.chatbotAllowed=false;c.chatEpoch=(c.chatEpoch or 0)+1 end
 return true
end
local function arena_round(k,now)
 local raw=redis.call('GET',k);if not raw then return nil end;local c=cjson.decode(raw)
 if arena_transition(c,now) then redis.call('SET',k,cjson.encode(c)) end;return c
end
local function arena_active(c,now)
 local phase=arena_phase(c,now);return not c.hidden and not arena_value(c.deletedAt) and (phase=='public' or phase=='private' or phase=='practice')
end
local function arena_submit(c,now,split)
 arena_transition(c,now);if not arena_active(c,now) then return false end
 local phase=arena_phase(c,now);if split=='private' and phase~='private' and phase~='practice' then return false end
 local access=c.submissionAccess and c.submissionAccess[split];return not access or (access.visible~=false and access.enabled~=false)
end
local function arena_chat(c,now)
 arena_transition(c,now);local untilAt=arena_value(c.chatbotUntil)
 return arena_active(c,now) and c.chatbotAllowed~=false and (not untilAt or now<untilAt)
end
`;

export const MATERIALIZE_PRIVATE_SCRIPT =
  ROUND_POLICY_LUA +
  `
local c=arena_round(KEYS[1],arena_now());if not c then return nil end;return cjson.encode(c)
`;
