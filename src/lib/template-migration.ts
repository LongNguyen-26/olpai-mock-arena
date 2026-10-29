import { randomUUID } from "node:crypto";
import { db, key } from "./db";
import { getAdminIds } from "./admins";
import { defaultTemplate, type WorkspaceTemplate } from "./workspace-domain";
import { sharedTemplateStore, templateStore } from "./workspace-templates";

const migrationId = "shared-chat-queue-v1";
export interface TemplateBackup {
  stores: Record<string, Record<string, WorkspaceTemplate>>;
  ready: string | null;
  version: string | null;
}
export function freshSharedTemplates(image: string) {
  if (!/^nguyenlong26\/olpai-workspace@sha256:[a-f0-9]{64}$/.test(image))
    throw new Error("Use the published immutable Workspace image digest.");
  return (["both", "llm", "jupyter"] as const).map((services) => ({
    ...defaultTemplate,
    id: randomUUID(),
    revision: randomUUID(),
    services,
    name:
      services === "both"
        ? "A40 · Chatbot + JupyterLab"
        : services === "llm"
          ? "A40 · Chỉ Chatbot"
          : "A5000 · Chỉ JupyterLab",
    gpuTypeId: services === "jupyter" ? "NVIDIA RTX A5000" : "NVIDIA A40",
    imageName: image,
    tokenLimitMode: "turn" as const,
    createdBy: "migration",
    updatedBy: "migration",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
}
export async function resetSharedTemplates(image: string, apply = false) {
  const marker = key(`gpu:migration:${migrationId}`),
    backupKey = key(`gpu:template-backup:${migrationId}`);
  const completed = await db().get<string>(marker);
  if (completed)
    return {
      applied: false,
      alreadyApplied: true,
      backupKey,
      templates: [] as WorkspaceTemplate[],
      backup: null,
    };
  const stores = [
    ...new Set([
      key("gpu:templates"),
      sharedTemplateStore(),
      ...(await getAdminIds()).map(templateStore),
    ]),
  ];
  const backup: TemplateBackup = {
    stores: Object.fromEntries(
      await Promise.all(
        stores.map(
          async (s) =>
            [
              s,
              (await db().hgetall<Record<string, WorkspaceTemplate>>(s)) ?? {},
            ] as const,
        ),
      ),
    ),
    ready: await db().get<string>(key("gpu:templates:shared:ready")),
    version: await db().get<string>(key("gpu:templates:version")),
  };
  const templates = freshSharedTemplates(image);
  if (!apply)
    return {
      applied: false,
      alreadyApplied: false,
      backupKey,
      templates,
      backup,
    };
  const result = await db().eval(
    `
 if redis.call('EXISTS',KEYS[1])==1 then return 2 end
 local b=cjson.decode(ARGV[1]);if (redis.call('GET',KEYS[5]) or '')~=ARGV[3] then return 0 end
 for store,values in pairs(b.stores) do local count=0;for id,t in pairs(values) do count=count+1;local raw=redis.call('HGET',store,id);if not raw then return 0 end;local old=cjson.decode(raw);if cjson.encode(old)~=cjson.encode(t) then return 0 end end;if redis.call('HLEN',store)~=count then return 0 end end
 redis.call('SET',KEYS[2],ARGV[1]);for store,_ in pairs(b.stores) do redis.call('DEL',store) end
 for _,t in ipairs(cjson.decode(ARGV[2])) do redis.call('HSET',KEYS[3],t.id,cjson.encode(t)) end
 redis.call('SET',KEYS[4],'1');redis.call('INCR',KEYS[5]);redis.call('SET',KEYS[1],KEYS[2]);return 1`,
    [
      marker,
      backupKey,
      sharedTemplateStore(),
      key("gpu:templates:shared:ready"),
      key("gpu:templates:version"),
    ],
    [JSON.stringify(backup), JSON.stringify(templates), backup.version ?? ""],
  );
  if (!result)
    throw new Error(
      "Templates changed during migration. Inspect and repeat the dry run.",
    );
  return {
    applied: result === 1,
    alreadyApplied: result === 2,
    backupKey,
    templates,
    backup,
  };
}
export async function restoreSharedTemplateBackup() {
  const backup = await db().get<TemplateBackup>(
    key(`gpu:template-backup:${migrationId}`),
  );
  if (!backup) throw new Error("Template backup not found.");
  await db().eval(
    `local b=cjson.decode(ARGV[1]);redis.call('DEL',KEYS[1]);for store,values in pairs(b.stores) do redis.call('DEL',store);for id,t in pairs(values) do redis.call('HSET',store,id,cjson.encode(t)) end end
 if b.ready==cjson.null then redis.call('DEL',KEYS[2]) else redis.call('SET',KEYS[2],b.ready) end
 if b.version==cjson.null then redis.call('DEL',KEYS[3]) else redis.call('SET',KEYS[3],b.version) end;redis.call('DEL',KEYS[4]);return 1`,
    [
      sharedTemplateStore(),
      key("gpu:templates:shared:ready"),
      key("gpu:templates:version"),
      key(`gpu:migration:${migrationId}`),
    ],
    [JSON.stringify(backup)],
  );
}
