-- Conversation snapshots are permanent; runtime jobs and leases retain their TTL.
update arena.runtime_history set expires_at=null where kind in ('chat-session','chat-group-session');
with jobs as (
 select distinct on (ns,payload->>'sessionKey') ns,payload from arena.runtime_history
 where kind='chat-job' and payload->>'sessionKey' is not null
 order by ns,payload->>'sessionKey',observed_at desc
), enriched as (
 select h.ns,h.kind,h.id,j.payload as job,t.payload->'template' as policy from arena.runtime_history h
 join jobs j on j.ns=h.ns and j.payload->>'sessionKey'=h.ns||case when h.kind='chat-group-session' then ':gpu:chat-group:' else ':gpu:chat:' end||h.id
 left join arena.runtime_history t on t.ns=j.ns and t.kind=case when j.payload->>'groupId' is not null then 'chat-group' else 'workspace' end
 and t.id=coalesce(j.payload->>'groupId',j.payload->>'workspaceId')
 where h.kind in ('chat-session','chat-group-session') and h.payload->'conversation' is null
)
update arena.runtime_history h set round_id=e.job->>'roundId',run_id=e.job->>'runId',
 payload=h.payload||jsonb_build_object('conversation',jsonb_build_object(
 'sessionId',e.job->>'sessionId','roundId',e.job->>'roundId','runId',e.job->>'runId','target',e.job->>'target',
 'audience',e.job->>'audience','teamId',e.job->'teamId','createdAt',coalesce((e.job->>'createdAt')::bigint,h.observed_at),
 'updatedAt',h.observed_at,'title',left(regexp_replace(coalesce(h.payload->'messages'->0->>'content','Cuộc trò chuyện'),'\s+',' ','g'),64),'policy',e.policy))
 from enriched e where h.ns=e.ns and h.kind=e.kind and h.id=e.id;
-- Legacy shared-Pod keys carry an explicit audience. Private legacy keys do
-- not: preserve those snapshots without guessing whether they belonged to an
-- administrator or the team.
with legacy as (
 select h.ns,h.kind,h.id,w.payload as workspace from arena.runtime_history h
 join arena.runtime_history w on w.ns=h.ns and w.kind='workspace' and w.id=split_part(h.id,':',1)
 where h.kind='chat-session' and h.payload->'conversation' is null
 and array_length(string_to_array(h.id,':'),1)=4
 and split_part(h.id,':',3) ~ '^(team|admin)-[a-zA-Z0-9-]+$'
)
update arena.runtime_history h set round_id=e.workspace->>'roundId',run_id=split_part(h.id,':',2),
 payload=h.payload||jsonb_build_object('conversation',jsonb_build_object(
 'sessionId',split_part(h.id,':',4),'roundId',e.workspace->>'roundId','runId',split_part(h.id,':',2),
 'target','workspace:'||split_part(h.id,':',1),'audience',split_part(h.id,':',3),
 'teamId',case when split_part(h.id,':',3) like 'team-%' then substr(split_part(h.id,':',3),6) else null end,
 'createdAt',h.observed_at,'updatedAt',h.observed_at,
 'title',left(regexp_replace(coalesce(h.payload->'messages'->0->>'content','Cuộc trò chuyện'),'\s+',' ','g'),64),
 'policy',e.workspace->'template'))
 from legacy e where h.ns=e.ns and h.kind=e.kind and h.id=e.id;
create index runtime_history_conversations on arena.runtime_history(ns,round_id,((payload->'conversation')->>'audience'),observed_at desc,id desc,kind desc)
 where kind in ('chat-session','chat-group-session');
