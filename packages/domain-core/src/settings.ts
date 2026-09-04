import { eq } from "drizzle-orm";
import {
  candidateGateSettingsSchema,
  trafficGateSettingsSchema,
  type CandidateGateSettings,
  type TrafficGateSettings,
} from "@dominio-x/contracts";
import { appSettings, type DbOrTx } from "@dominio-x/database";

export const SETTING_KEYS = {
  CANDIDATE_GATE: "candidate_gate",
  TRAFFIC_GATE: "traffic_gate",
} as const;

export async function getCandidateGateSettings(db: DbOrTx): Promise<CandidateGateSettings> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, SETTING_KEYS.CANDIDATE_GATE),
  });
  const parsed = candidateGateSettingsSchema.safeParse(row?.valueJson ?? {});
  return parsed.success ? parsed.data : candidateGateSettingsSchema.parse({});
}

export async function updateCandidateGateSettings(
  db: DbOrTx,
  patch: Partial<CandidateGateSettings>,
  updatedBy: string | null,
): Promise<CandidateGateSettings> {
  const current = await getCandidateGateSettings(db);
  const next = candidateGateSettingsSchema.parse({ ...current, ...patch });
  await db
    .insert(appSettings)
    .values({ key: SETTING_KEYS.CANDIDATE_GATE, valueJson: next, updatedBy })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueJson: next, updatedBy, updatedAt: new Date() },
    });
  return next;
}

/** Free qualification policy for the paid traffic provider. See `traffic-gate.ts`. */
export async function getTrafficGateSettings(db: DbOrTx): Promise<TrafficGateSettings> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, SETTING_KEYS.TRAFFIC_GATE),
  });
  const parsed = trafficGateSettingsSchema.safeParse(row?.valueJson ?? {});
  return parsed.success ? parsed.data : trafficGateSettingsSchema.parse({});
}

export async function updateTrafficGateSettings(
  db: DbOrTx,
  patch: Partial<TrafficGateSettings>,
  updatedBy: string | null,
): Promise<TrafficGateSettings> {
  const current = await getTrafficGateSettings(db);
  const next = trafficGateSettingsSchema.parse({ ...current, ...patch });
  await db
    .insert(appSettings)
    .values({ key: SETTING_KEYS.TRAFFIC_GATE, valueJson: next, updatedBy })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueJson: next, updatedBy, updatedAt: new Date() },
    });
  return next;
}

export async function getAllSettings(
  db: DbOrTx,
): Promise<{ candidateGate: CandidateGateSettings; trafficGate: TrafficGateSettings }> {
  return {
    candidateGate: await getCandidateGateSettings(db),
    trafficGate: await getTrafficGateSettings(db),
  };
}
