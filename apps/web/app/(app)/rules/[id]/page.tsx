"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useRole } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Input,
  Loading,
  PageHeader,
  Textarea,
} from "@/components/ui";

interface Rule {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  priority: number;
  enabled: boolean;
  conditionJson: unknown;
  actionJson: unknown;
  reasonCode: string;
}
interface Detail {
  ruleset: { id: string; name: string; version: number; status: string; description: string };
  rules: Rule[];
}
interface TestResult {
  domainId: string;
  asciiFqdn: string;
  evaluation: {
    summary: {
      disposition: string;
      candidateDecision: string | null;
      scoreAdjustments: Record<string, number>;
      tags: string[];
    };
    executions: { ruleKey: string; matched: boolean }[];
  };
}

function toEditable(rules: Rule[]) {
  return JSON.stringify(
    rules.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      category: r.category,
      priority: r.priority,
      enabled: r.enabled,
      reasonCode: r.reasonCode,
      condition: r.conditionJson,
      action: r.actionJson,
    })),
    null,
    2,
  );
}

export default function RulesetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { isAnalyst, isAdmin } = useRole();
  const q = useQuery({
    queryKey: ["ruleset", id],
    queryFn: () => api.get<Detail>(`/rulesets/${id}`),
  });
  const [json, setJson] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [testIds, setTestIds] = useState("");
  const [issues, setIssues] = useState<{ ruleKey: string; path: string; message: string }[] | null>(
    null,
  );
  useEffect(() => {
    if (q.data) {
      setJson(toEditable(q.data.rules));
      setName(q.data.ruleset.name);
      setDescription(q.data.ruleset.description);
    }
  }, [q.data]);
  const parseRules = () => JSON.parse(json) as unknown[];
  const validate = useMutation({
    mutationFn: () =>
      api.post<{ issues: { ruleKey: string; path: string; message: string }[] }>(
        "/rulesets/validate",
        { name, description, rules: parseRules() },
      ),
    onSuccess: (r) => setIssues(r.issues),
  });
  const save = useMutation({
    mutationFn: () => api.patch(`/rulesets/${id}`, { name, description, rules: parseRules() }),
    onSuccess: () => {
      setIssues([]);
      void qc.invalidateQueries({ queryKey: ["ruleset", id] });
    },
  });
  const activate = useMutation({
    mutationFn: () => api.post(`/rulesets/${id}/activate`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ruleset", id] });
      void qc.invalidateQueries({ queryKey: ["rulesets"] });
    },
  });
  const clone = useMutation({
    mutationFn: () => api.post<{ ruleset: { id: string } }>(`/rulesets/${id}/clone`),
    onSuccess: (r) => router.push(`/rules/${r.ruleset.id}`),
  });
  const test = useMutation({
    mutationFn: () =>
      api.post<{ results: TestResult[] }>(`/rulesets/${id}/test`, {
        domainIds: testIds.split(/[\s,]+/).filter(Boolean),
      }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rs = q.data!.ruleset;
  const editable = isAnalyst && rs.status === "draft";
  return (
    <div>
      <PageHeader
        title={
          <span>
            {rs.name} <span className="text-neutral-400">v{rs.version}</span>{" "}
            <Badge value={rs.status} />
          </span>
        }
        actions={
          <>
            {isAnalyst && <Button onClick={() => clone.mutate()}>Clone to draft</Button>}
            {editable && <Button onClick={() => validate.mutate()}>Validate</Button>}
            {editable && (
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                Save draft
              </Button>
            )}
            {isAdmin && rs.status === "draft" && (
              <Button variant="primary" onClick={() => activate.mutate()}>
                Activate
              </Button>
            )}
          </>
        }
      />
      <ErrorBox
        error={validate.error ?? save.error ?? activate.error ?? clone.error ?? test.error}
      />
      {issues &&
        (issues.length === 0 ? (
          <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Ruleset is valid.
          </div>
        ) : (
          <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <ul>
              {issues.map((i, n) => (
                <li key={n}>
                  <b>{i.ruleKey}</b> {i.path}: {i.message}
                </li>
              ))}
            </ul>
          </div>
        ))}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Definition" className="lg:col-span-2">
          <div className="mb-2 grid gap-2 md:grid-cols-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!editable}
              placeholder="description"
            />
          </div>
          <Textarea
            rows={28}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            readOnly={!editable}
          />
          <p className="mt-2 text-xs text-neutral-500">
            JSON array of rules. Condition: {"{ metric, op, value }"} or{" "}
            {"{ all: [...] } / { any: [...] } / { not: ... }"}. Regexes use RE2 (no backtracking).
          </p>
        </Card>
        <Card title="Test against domains">
          <Textarea
            rows={4}
            placeholder="domain ids (uuid), comma or newline separated"
            value={testIds}
            onChange={(e) => setTestIds(e.target.value)}
          />
          <Button className="mt-2" onClick={() => test.mutate()} disabled={!testIds.trim()}>
            Run test (dry-run)
          </Button>
          {test.data && (
            <ul className="mt-3 space-y-2 text-sm">
              {test.data.results.map((r) => (
                <li key={r.domainId} className="rounded border border-neutral-200 p-2">
                  <div className="font-medium">
                    {r.asciiFqdn} → <Badge value={r.evaluation.summary.disposition} />{" "}
                    {r.evaluation.summary.candidateDecision && (
                      <span className="text-xs">
                        candidate {r.evaluation.summary.candidateDecision}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">
                    matched:{" "}
                    {r.evaluation.executions
                      .filter((e) => e.matched)
                      .map((e) => e.ruleKey)
                      .join(", ") || "none"}{" "}
                    · adjustments {JSON.stringify(r.evaluation.summary.scoreAdjustments)} · tags{" "}
                    {r.evaluation.summary.tags.join(", ") || "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
