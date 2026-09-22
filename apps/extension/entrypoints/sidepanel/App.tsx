import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL, ApiError, chromeTokenStore, createApi } from "../../src/api";
import { ErrorScreen, type PanelError } from "./ErrorScreen";
import { EvaluatingScreen } from "./EvaluatingScreen";
import { HistoryScreen } from "./HistoryScreen";
import { PreviewScreen, type ExtractSection } from "./PreviewScreen";
import { ResultScreen, type ResultEvaluation } from "./ResultScreen";
import { RoleScreen, type DraftResult } from "./RoleScreen";
import { RubricScreen } from "./RubricScreen";
import { SignInScreen } from "./SignInScreen";

const tokenStore = chromeTokenStore();
const api = createApi(API_BASE_URL, tokenStore);

type Screen = "boot" | "signin" | "role" | "rubric" | "preview" | "evaluating" | "result" | "error" | "history";
type EvaluateBody = { approvedText: string; comparisonEnabled: boolean; keepExtracts: boolean };

function titleFromNotes(notes: string) {
  const line = notes.split(/[\n.]/)[0]?.trim() ?? "";
  return line.slice(0, 80) || "Role";
}

function withLabels(evaluation: ResultEvaluation, criteria: DraftResult["criteria"]): ResultEvaluation {
  const labels = new Map(criteria.map((item) => [item.id, item.label]));
  return {
    ...evaluation,
    answers: evaluation.answers.map((answer) => ({
      ...answer,
      label: answer.label ?? labels.get(answer.criterionId),
    })),
  };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("boot");
  const [signInError, setSignInError] = useState<string | undefined>();
  const [role, setRole] = useState<{ id: string; title: string } | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [criteria, setCriteria] = useState<DraftResult["criteria"]>([]);
  const [rubricId, setRubricId] = useState<string | null>(null);
  const [extract, setExtract] = useState<{ url: string; sections: ExtractSection[] } | null>(null);
  const [evaluation, setEvaluation] = useState<ResultEvaluation | null>(null);
  const [panelError, setPanelError] = useState<PanelError | null>(null);
  const [usesRemaining, setUsesRemaining] = useState<number | undefined>();
  const [evalKey, setEvalKey] = useState<string | null>(null);
  const [evalBody, setEvalBody] = useState<EvaluateBody | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await tokenStore.get();
      if (!token) {
        setScreen("signin");
        return;
      }
      try {
        const me = await api.me();
        setUsesRemaining(me.usesRemaining);
        setScreen("role");
      } catch {
        setScreen("signin");
      }
    })();
  }, []);

  const runEvaluate = useCallback(
    async (body: EvaluateBody, key: string) => {
      if (!role || !rubricId) throw new Error("missing rubric");
      setScreen("evaluating");
      try {
        const result = (await api.evaluate({
          roleId: role.id,
          rubricVersionId: rubricId,
          idempotencyKey: key,
          ...body,
        })) as ResultEvaluation;
        setEvaluation(withLabels(result, criteria));
        setUsesRemaining(result.usesRemaining);
        setEvalKey(null);
        setScreen("result");
      } catch (error) {
        if (error instanceof ApiError) {
          const bodyJson = error.body && typeof error.body === "object" ? (error.body as { usesRemaining?: number }) : {};
          setPanelError({ status: error.status, body: error.body });
          if (typeof bodyJson.usesRemaining === "number") setUsesRemaining(bodyJson.usesRemaining);
          setScreen("error");
          return;
        }
        throw error;
      }
    },
    [role, rubricId, criteria],
  );

  const roleApi = useMemo(
    () => ({
      async draftRubric(notes: string) {
        const created = await api.createRole(titleFromNotes(notes));
        setRole(created);
        return api.draftRubric(created.id, notes);
      },
    }),
    [],
  );

  const rubricApi = useMemo(
    () => ({
      async approveRubric(next: DraftResult["criteria"]) {
        if (!role) throw new Error("missing role");
        const approved = await api.approveRubric(role.id, next);
        setCriteria(next);
        setRubricId(approved.id);
        return approved;
      },
    }),
    [role],
  );

  const previewApi = useMemo(
    () => ({
      async evaluate(body: EvaluateBody) {
        const key = evalKey ?? crypto.randomUUID();
        setEvalKey(key);
        setEvalBody(body);
        await runEvaluate(body, key);
      },
    }),
    [evalKey, runEvaluate],
  );

  async function loadExtract() {
    const stored = await chrome.storage.session.get("extract");
    const value = stored.extract as { url?: string; sections?: ExtractSection[] } | undefined;
    if (value?.url && value.sections) setExtract({ url: value.url, sections: value.sections });
  }

  if (screen === "boot") return null;
  if (screen === "signin") {
    return (
      <SignInScreen
        error={signInError}
        onSubmit={async (email, password) => {
          try {
            await api.login(email, password);
            setSignInError(undefined);
            setScreen("role");
          } catch {
            setSignInError("Sign in failed");
          }
        }}
      />
    );
  }
  if (screen === "role") {
    return (
      <RoleScreen
        api={roleApi}
        onDrafted={(next) => {
          setDraft(next);
          setScreen("rubric");
        }}
      />
    );
  }
  if (screen === "rubric" && draft) {
    return (
      <RubricScreen
        criteria={draft.criteria}
        omitted={draft.omitted}
        usage={draft.usage}
        cost={draft.cost}
        roleTitle={role?.title}
        api={rubricApi}
        onApproved={() => {
          void loadExtract().then(() => setScreen("preview"));
        }}
      />
    );
  }
  if (screen === "preview") {
    if (!extract) {
      return (
        <section className="panel">
          <p className="lede">Open the toolbar on a profile tab to capture the extract.</p>
        </section>
      );
    }
    return (
      <PreviewScreen
        url={extract.url}
        roleTitle={role?.title ?? ""}
        sections={extract.sections}
        api={previewApi}
        onEvaluated={() => undefined}
      />
    );
  }
  if (screen === "evaluating") {
    return <EvaluatingScreen roleTitle={role?.title} />;
  }
  if (screen === "error" && panelError) {
    return (
      <ErrorScreen
        error={panelError}
        usesRemaining={usesRemaining}
        onRetry={
          evalBody && evalKey
            ? () => {
                void runEvaluate(evalBody, evalKey);
              }
            : undefined
        }
      />
    );
  }
  if (screen === "result" && evaluation) {
    return (
      <ResultScreen
        evaluation={evaluation}
        roleTitle={role?.title}
        api={{
          correct: (id, action) => api.correct(id, action),
          saveNote: (id, notes) => api.saveNote(id, notes),
        }}
        onOpenHistory={() => setScreen("history")}
      />
    );
  }
  if (screen === "history") {
    return (
      <HistoryScreen
        usesRemaining={usesRemaining ?? 0}
        api={{
          list: () => api.listEvaluations(),
          deleteAll: async () => {
            await api.deleteEvaluations();
            const me = await api.me();
            setUsesRemaining(me.usesRemaining);
          },
        }}
      />
    );
  }
  return null;
}
