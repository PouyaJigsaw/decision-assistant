import { useCallback, useEffect, useMemo, useState } from "react";
import { parseJobPosting } from "@decision-assistant/domain";
import { API_BASE_URL, ApiError, chromeTokenStore, createApi } from "../../src/api";
import { pickCaptureTab } from "../../src/capture-tab";
import { CHATGPT_USAGE_URL, createChromeOAuthHost, loadChatGptAuth } from "../../src/chatgpt-oauth";
import { extractSections } from "../../src/extract";
import {
  chromeDualKv,
  clearSessionApiKey,
  getConnection,
  setSessionApiKey,
  type Connection,
} from "../../src/llm-credentials";
import { OpenAiError, listModels, type ListedModel } from "../../src/openai-responses";
import { readDocument } from "../../src/read-document";
import { completeCompare, completeDraft, selectedModel, setSelectedModel } from "../../src/user-llm";
import { billingCopy, ConnectionScreen } from "./ConnectionScreen";
import { DashboardScreen } from "./DashboardScreen";
import { ErrorScreen, type PanelError } from "./ErrorScreen";
import { EvaluatingScreen } from "./EvaluatingScreen";
import { HistoryScreen, type HistoryRow } from "./HistoryScreen";
import { PanelHeader } from "./PanelHeader";
import { PreviewScreen, type ExtractSection } from "./PreviewScreen";
import { ResultScreen, type ResultEvaluation } from "./ResultScreen";
import { RoleScreen, type DraftResult } from "./RoleScreen";
import { RubricScreen } from "./RubricScreen";
import { SittingScreen } from "./SittingScreen";
import { SignInScreen } from "./SignInScreen";

const tokenStore = chromeTokenStore();
const api = createApi(API_BASE_URL, tokenStore);
const kv = chromeDualKv();
const oauthHost = createChromeOAuthHost();

type Screen =
  | "boot"
  | "signin"
  | "dashboard"
  | "role"
  | "rubric"
  | "sitting"
  | "preview"
  | "evaluating"
  | "result"
  | "error"
  | "history"
  | "connection";
type EvaluateBody = {
  approvedText: string;
  comparisonEnabled: boolean;
  keepExtracts: boolean;
  candidateName?: string;
};

function candidateNameFromExtract(
  extract: { candidateName?: string; sections: ExtractSection[] } | null,
): string {
  if (extract?.candidateName?.trim()) return extract.candidateName.trim();
  const headline = extract?.sections.find((section) => section.title === "Headline");
  if (!headline) return "";
  return headline.text.split(/\s+[—–-]\s+/)[0]?.trim() ?? "";
}

function authErrorCopy(error: unknown, kind: "signin" | "signup"): string {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const code = (error.body as { error?: string }).error;
    if (code === "email_taken") return "That email is already registered.";
    if (code === "invalid_credentials") return "Use a valid email and a password of at least 8 characters.";
  }
  return kind === "signup" ? "Sign up failed" : "Sign in failed";
}

function asExtract(value: unknown): { url: string; sections: ExtractSection[]; candidateName?: string } | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as { url?: string; sections?: ExtractSection[]; candidateName?: string };
  if (typeof rec.url === "string" && Array.isArray(rec.sections)) {
    return {
      url: rec.url,
      sections: rec.sections,
      candidateName: typeof rec.candidateName === "string" ? rec.candidateName : "",
    };
  }
  return null;
}

type RoleRecord = { id: string; title: string; company?: string; summary?: string; notes?: string };

function asRole(value: unknown): RoleRecord | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as RoleRecord;
  if (typeof rec.id === "string" && typeof rec.title === "string") {
    return {
      id: rec.id,
      title: rec.title,
      company: typeof rec.company === "string" ? rec.company : "",
      summary: typeof rec.summary === "string" ? rec.summary : "",
      notes: typeof rec.notes === "string" ? rec.notes : "",
    };
  }
  return null;
}

function jobDescriptionFor(role: RoleRecord | null, fallback = ""): string {
  if (role?.notes?.trim()) return role.notes;
  return [role?.title, role?.company, role?.summary].filter(Boolean).join("\n\n") || fallback;
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
  const [role, setRole] = useState<RoleRecord | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [criteria, setCriteria] = useState<DraftResult["criteria"]>([]);
  const [rubricId, setRubricId] = useState<string | null>(null);
  const [extract, setExtract] = useState<{ url: string; sections: ExtractSection[]; candidateName?: string } | null>(
    null,
  );
  const [evaluation, setEvaluation] = useState<ResultEvaluation | null>(null);
  const [panelError, setPanelError] = useState<PanelError | null>(null);
  const [usesRemaining, setUsesRemaining] = useState<number | null | undefined>();
  const [trialCap, setTrialCap] = useState<number | null>(3);
  const [evalKey, setEvalKey] = useState<string | null>(null);
  const [evalBody, setEvalBody] = useState<EvaluateBody | null>(null);
  const [captureError, setCaptureError] = useState<string | undefined>();
  const [jobNotes, setJobNotes] = useState("");
  const [openedFromHistory, setOpenedFromHistory] = useState(false);
  const [openedFromDashboard, setOpenedFromDashboard] = useState(false);
  const [historyFrom, setHistoryFrom] = useState<"dashboard" | "result">("result");
  const [roleFrom, setRoleFrom] = useState<"dashboard" | "sitting">("dashboard");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<{ id: string; title: string; company?: string; summary?: string }[]>([]);
  const [recent, setRecent] = useState<HistoryRow[]>([]);
  const [totals, setTotals] = useState({ jevUsd: 0, llmUsd: 0 });
  const [dashboardError, setDashboardError] = useState<string | undefined>();
  const [connection, setConnection] = useState<Connection>({ kind: "none" });
  const [models, setModels] = useState<ListedModel[]>([]);
  const [modelSlug, setModelSlug] = useState("gpt-5.4");
  const [showWelcome, setShowWelcome] = useState(false);
  const [connectionError, setConnectionError] = useState<string | undefined>();

  const enterDashboard = useCallback(async () => {
    try {
      const me = await api.me();
      setEmail(me.email);
      setUsesRemaining(me.usesRemaining);
      setTrialCap(me.cap ?? null);
    } catch {
      setScreen("signin");
      return;
    }
    try {
      const [rolesRes, evals] = await Promise.all([api.listRoles(), api.listEvaluations()]);
      setRoles(rolesRes.roles ?? []);
      setRecent(evals.evaluations ?? []);
      setTotals(evals.totals ?? { jevUsd: 0, llmUsd: 0 });
    } catch {
      setRoles([]);
      setRecent([]);
      setTotals({ jevUsd: 0, llmUsd: 0 });
    }
    setDashboardError(undefined);
    await refreshConnection();
    setScreen("dashboard");
  }, []);

  async function refreshConnection() {
    const next = await getConnection(kv);
    setConnection(next);
    setModelSlug(await selectedModel(kv));
    if (next.kind === "chatgpt" && next.planUsage) {
      const stored = await chrome.storage.local.get("chatgptPlanWelcomed");
      setShowWelcome(!stored.chatgptPlanWelcomed);
      try {
        const auth = await loadChatGptAuth(kv.local);
        if (auth?.access_token) {
          setModels(await listModels({ token: auth.access_token, planUsage: true }));
        }
      } catch {
        setModels([]);
      }
    } else {
      setShowWelcome(false);
      setModels([]);
    }
  }

  function needsModel(): boolean {
    if (connection.kind === "api_key") return false;
    if (connection.kind === "chatgpt" && connection.planUsage) return false;
    return true;
  }

  useEffect(() => {
    void (async () => {
      const token = await tokenStore.get();
      if (!token) {
        setScreen("signin");
        return;
      }
      try {
        const stored = await chrome.storage.session.get(["panelRole", "panelRubricId", "panelCriteria", "extract"]);
        const nextRole = asRole(stored.panelRole);
        const nextRubric = typeof stored.panelRubricId === "string" ? stored.panelRubricId : null;
        const nextCriteria = Array.isArray(stored.panelCriteria) ? stored.panelCriteria : [];
        const nextExtract = asExtract(stored.extract);
        if (nextRole) setRole(nextRole);
        if (nextRubric) setRubricId(nextRubric);
        if (nextCriteria.length) setCriteria(nextCriteria);
        if (nextExtract) setExtract(nextExtract);
        await enterDashboard();
      } catch {
        setScreen("signin");
      }
    })();

    function onExtractChanged(changes: Record<string, { newValue?: unknown }>) {
      if (!("extract" in changes)) return;
      const next = asExtract(changes.extract?.newValue);
      if (!next) return;
      setExtract(next);
      setScreen((current) =>
        current === "signin" ||
        current === "boot" ||
        current === "role" ||
        current === "rubric" ||
        current === "dashboard" ||
        current === "sitting"
          ? current
          : "preview",
      );
    }
    chrome.storage.session.onChanged.addListener(onExtractChanged);
    return () => chrome.storage.session.onChanged.removeListener(onExtractChanged);
  }, [enterDashboard]);

  const runEvaluate = useCallback(
    async (body: EvaluateBody, key: string) => {
      if (!role || !rubricId) throw new Error("missing rubric");
      if (body.comparisonEnabled && needsModel()) {
        setScreen("connection");
        return;
      }
      setScreen("evaluating");
      try {
        const result = (await api.evaluate({
          roleId: role.id,
          rubricVersionId: rubricId,
          idempotencyKey: key,
          ...body,
          candidateName: body.candidateName ?? candidateNameFromExtract(extract),
        })) as ResultEvaluation & { comparison?: { instructions: string; input: string } };
        let next = result;
        if (result.comparison) {
          try {
            const completion = await completeCompare(kv, oauthHost, criteria, body.approvedText);
            next = (await api.postComparison(result.id, completion)) as ResultEvaluation;
          } catch (error) {
            if (error instanceof OpenAiError && error.manageUsage) {
              setPanelError({ status: error.status, body: { error: error.code } });
              setScreen("error");
              return;
            }
          }
        }
        setEvaluation(withLabels(next, criteria));
        setOpenedFromHistory(false);
        setOpenedFromDashboard(false);
        setUsesRemaining(next.usesRemaining);
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
        setPanelError({ status: 0, body: { error: "network" } });
        setScreen("error");
      }
    },
    [role, rubricId, criteria, extract, connection],
  );

  const roleApi = useMemo(
    () => ({
      async draftRubric(notes: string) {
        if (needsModel()) {
          setScreen("connection");
          throw new Error("llm_not_connected");
        }
        setJobNotes(notes);
        const posting = parseJobPosting(notes);
        const completion = await completeDraft(kv, oauthHost, notes);
        if (role) {
          const next = { ...role, ...posting, notes };
          setRole(next);
          await chrome.storage.session.set({ panelRole: next });
          return api.draftRubric(role.id, notes, completion);
        }
        const created = await api.createRole(posting.title, {
          company: posting.company,
          summary: posting.summary,
        });
        const next = { ...created, notes };
        setRole(next);
        await chrome.storage.session.set({ panelRole: next });
        return api.draftRubric(created.id, notes, completion);
      },
    }),
    [role, connection],
  );

  const rubricApi = useMemo(
    () => ({
      async approveRubric(next: DraftResult["criteria"]) {
        if (!role) throw new Error("missing role");
        const approved = await api.approveRubric(role.id, next);
        setCriteria(next);
        setRubricId(approved.id);
        await chrome.storage.session.set({ panelRubricId: approved.id, panelCriteria: next });
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
    const next = asExtract(stored.extract);
    if (next) setExtract(next);
    return next;
  }

  async function captureFromActiveTab() {
    setCaptureError(undefined);
    try {
      const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
      const tab = pickCaptureTab(tabs);
      if (tab?.id == null) {
        throw new Error(`No web page in this window. Tabs: ${tabs.map((item) => item.url ?? "(no url)").join(" | ") || "(none)"}`);
      }
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readDocument,
      });
      const doc = injected[0]?.result;
      if (!doc) {
        throw new Error(`Script returned nothing from ${tab.url ?? `tab ${tab.id}`}`);
      }
      const extracted = extractSections({ ...doc, title: doc.title || tab.title || "" });
      const next = {
        url: extracted.url,
        sections: extracted.sections,
        candidateName: extracted.candidateName,
      };
      setExtract(next);
      await chrome.storage.session.set({ extract: { ...next, capturedAt: Date.now() } });
      return true;
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function clearEvaluation() {
    setEvaluation(null);
    setEvalKey(null);
    setEvalBody(null);
    setPanelError(null);
    setOpenedFromHistory(false);
    setOpenedFromDashboard(false);
  }

  async function clearSitting() {
    clearEvaluation();
    setRole(null);
    setDraft(null);
    setCriteria([]);
    setRubricId(null);
    setCaptureError(undefined);
    setOpenedFromDashboard(false);
    setDashboardError(undefined);
    await chrome.storage.session.remove(["panelRole", "panelRubricId", "panelCriteria"]);
  }

  async function startNewJob() {
    await clearSitting();
    await enterDashboard();
  }

  async function openNewJob() {
    await clearSitting();
    setRoleFrom("dashboard");
    setScreen("role");
  }

  async function openSavedRole(roleId: string) {
    try {
      const rubric = (await api.getCurrentRubric(roleId)) as {
        id: string;
        criteria: DraftResult["criteria"];
        notes?: string;
        title?: string;
        company?: string;
        summary?: string;
      };
      const listed = roles.find((item) => item.id === roleId);
      const nextRole: RoleRecord = {
        id: roleId,
        title: rubric.title || listed?.title || "Role",
        company: rubric.company || listed?.company || "",
        summary: rubric.summary || listed?.summary || "",
        notes: rubric.notes || "",
      };
      setRole(nextRole);
      setJobNotes(nextRole.notes || jobDescriptionFor(nextRole));
      setRubricId(rubric.id);
      setCriteria(rubric.criteria);
      await chrome.storage.session.set({
        panelRole: nextRole,
        panelRubricId: rubric.id,
        panelCriteria: rubric.criteria,
      });
      setDashboardError(undefined);
      await loadExtract();
      setScreen("sitting");
    } catch {
      setDashboardError("This role has no approved rubric yet.");
    }
  }

  async function continueSitting() {
    const next = await loadExtract();
    setScreen(next ? "preview" : "sitting");
  }

  function editJobDescription(from: "sitting" | "dashboard" = "sitting") {
    setRoleFrom(from);
    setJobNotes(jobDescriptionFor(role, jobNotes));
    setScreen("role");
  }

  function backFromExtract() {
    setScreen(extract ? "preview" : "sitting");
  }

  async function signOut() {
    await api.logout();
    await clearSitting();
    setEmail("");
    setRoles([]);
    setRecent([]);
    setTotals({ jevUsd: 0, llmUsd: 0 });
    setScreen("signin");
  }

  function recaptureFromResult() {
    void captureFromActiveTab().then((ok) => {
      if (!ok) return;
      clearEvaluation();
      setScreen("preview");
    });
  }

  if (screen === "boot") return null;
  if (screen === "connection") {
    return (
      <ConnectionScreen
        connection={connection}
        models={models}
        selectedModel={modelSlug}
        showWelcome={showWelcome}
        error={connectionError}
        onConnectChatGpt={async () => {
          setConnectionError(undefined);
          const response = (await chrome.runtime.sendMessage({ type: "chatgpt-signin" })) as
            | { ok: true }
            | { ok: false; error?: string };
          if (!response?.ok) {
            setConnectionError(response?.error === "access_denied" ? "ChatGPT plan usage was not enabled." : "ChatGPT sign-in failed.");
            await refreshConnection();
            return;
          }
          await refreshConnection();
        }}
        onDisconnect={async () => {
          await chrome.runtime.sendMessage({ type: "chatgpt-disconnect" });
          await refreshConnection();
        }}
        onSaveKey={async (key) => {
          await setSessionApiKey(kv, key);
          setConnectionError(undefined);
          await refreshConnection();
        }}
        onClearKey={async () => {
          await clearSessionApiKey(kv);
          await refreshConnection();
        }}
        onSelectModel={(slug) => {
          setModelSlug(slug);
          void setSelectedModel(kv, slug);
        }}
        onManageUsage={() => {
          void chrome.tabs.create({ url: CHATGPT_USAGE_URL });
        }}
        onDismissWelcome={() => {
          setShowWelcome(false);
          void chrome.storage.local.set({ chatgptPlanWelcomed: true });
        }}
        onBack={() => void enterDashboard()}
      />
    );
  }
  if (screen === "dashboard") {
    return (
      <DashboardScreen
        email={email}
        usesRemaining={usesRemaining ?? null}
        cap={trialCap}
        totals={totals}
        sitting={role && rubricId ? { title: role.title } : null}
        roles={roles}
        recent={recent}
        error={dashboardError}
        onNewJob={() => void openNewJob()}
        onModel={() => {
          void refreshConnection().then(() => setScreen("connection"));
        }}
        onContinue={() => void continueSitting()}
        onOpenRole={(id) => void openSavedRole(id)}
        onDeleteRoles={() => {
          void (async () => {
            try {
              await api.deleteRoles();
              setRoles([]);
              await clearSitting();
            } catch {
              setDashboardError("Could not delete saved roles.");
            }
          })();
        }}
        onOpen={(id) => {
          void api.getEvaluation(id).then((row) => {
            setEvaluation(withLabels(row as ResultEvaluation, criteria));
            setOpenedFromHistory(false);
            setOpenedFromDashboard(true);
            setScreen("result");
          });
        }}
        onHistory={() => {
          setHistoryFrom("dashboard");
          setScreen("history");
        }}
        onSignOut={() => void signOut()}
      />
    );
  }
  if (screen === "signin") {
    return (
      <SignInScreen
        error={signInError}
        onSubmit={async (email, password) => {
          try {
            await api.login(email, password);
            setSignInError(undefined);
            await enterDashboard();
          } catch {
            setSignInError("Sign in failed");
          }
        }}
        onSignup={async (email, password) => {
          try {
            await api.signup(email, password);
            setSignInError(undefined);
            await enterDashboard();
          } catch (error) {
            setSignInError(authErrorCopy(error, "signup"));
          }
        }}
      />
    );
  }
  if (screen === "role") {
    return (
      <RoleScreen
        api={roleApi}
        billing={billingCopy(connection)}
        initialNotes={jobNotes}
        onBack={() => {
          if (roleFrom === "sitting") {
            setScreen("sitting");
            return;
          }
          void enterDashboard();
        }}
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
          void loadExtract().then((next) => setScreen(next ? "preview" : "sitting"));
        }}
        onChangeJob={() => editJobDescription(roleFrom)}
        onBack={() => setScreen("role")}
      />
    );
  }
  if (screen === "sitting") {
    return (
      <SittingScreen
        roleTitle={role?.title ?? "Role"}
        company={role?.company}
        jobDescription={jobDescriptionFor(role, jobNotes)}
        criteria={criteria}
        onReadTab={() => {
          void captureFromActiveTab().then((ok) => {
            if (ok) setScreen("preview");
          });
        }}
        onChangeJob={() => editJobDescription("sitting")}
        onBack={() => void enterDashboard()}
        captureError={captureError}
      />
    );
  }
  if (screen === "preview") {
    if (!extract) {
      return (
        <SittingScreen
          roleTitle={role?.title ?? "Role"}
          company={role?.company}
          jobDescription={jobDescriptionFor(role, jobNotes)}
          criteria={criteria}
          onReadTab={() => {
            void captureFromActiveTab();
          }}
          onChangeJob={() => editJobDescription("sitting")}
          onBack={() => void enterDashboard()}
          captureError={captureError}
        />
      );
    }
    return (
      <PreviewScreen
        url={extract.url}
        roleTitle={role?.title ?? ""}
        sections={extract.sections}
        api={previewApi}
        onEvaluated={() => undefined}
        onRecapture={() => void captureFromActiveTab()}
        onChangeJob={() => editJobDescription("sitting")}
        onBack={() => setScreen("sitting")}
        captureError={captureError}
        billing={billingCopy(connection)}
      />
    );
  }
  if (screen === "evaluating") {
    return <EvaluatingScreen roleTitle={role?.title} onBack={backFromExtract} />;
  }
  if (screen === "error" && panelError) {
    return (
      <ErrorScreen
        error={panelError}
        usesRemaining={usesRemaining}
        cap={trialCap}
        onBack={backFromExtract}
        onManageUsage={() => {
          void chrome.tabs.create({ url: CHATGPT_USAGE_URL });
        }}
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
        billing={billingCopy(connection)}
        roleTitle={evaluation.roleTitle ?? role?.title}
        api={{
          saveNote: (id, notes) => api.saveNote(id, notes),
        }}
        onRetry={() => {
          clearEvaluation();
          setScreen("preview");
        }}
        onRecapture={recaptureFromResult}
        onChangeJob={() => void startNewJob()}
        captureError={captureError}
        cap={trialCap}
        onOpenHistory={
          openedFromDashboard
            ? undefined
            : () => {
                setHistoryFrom("result");
                setScreen("history");
              }
        }
        onBack={() => {
          if (openedFromDashboard) {
            void enterDashboard();
            return;
          }
          if (openedFromHistory) {
            setScreen("history");
            return;
          }
          backFromExtract();
        }}
      />
    );
  }
  if (screen === "history") {
    return (
      <HistoryScreen
        usesRemaining={usesRemaining ?? null}
        cap={trialCap}
        api={{
          list: () => api.listEvaluations(),
          deleteAll: async () => {
            await api.deleteEvaluations();
            const me = await api.me();
            setUsesRemaining(me.usesRemaining);
            setTrialCap(me.cap ?? null);
          },
        }}
        onBack={() => setScreen(historyFrom === "dashboard" ? "dashboard" : evaluation ? "result" : "preview")}
        onOpen={(id) => {
          void api.getEvaluation(id).then((row) => {
            setEvaluation(withLabels(row as ResultEvaluation, criteria));
            setOpenedFromHistory(true);
            setOpenedFromDashboard(false);
            setScreen("result");
          });
        }}
      />
    );
  }
  return null;
}
