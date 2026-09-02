import { eq } from "drizzle-orm";
import { candidateGateSettingsSchema, type CandidateGateSettings } from "@dominio-x/contracts";
import { appSettings, type DbOrTx } from "@dominio-x/database";

export const SETTING_KEYS = { CANDIDATE_GATE: "candidate_gate" } as const;

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

export async function getAllSettings(
  db: DbOrTx,
): Promise<{ candidateGate: CandidateGateSettings }> {
  return { candidateGate: await getCandidateGateSettings(db) };
}
