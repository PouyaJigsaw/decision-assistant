import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, chromeTokenStore, createApi } from "../../src/api";
import { PreviewScreen, type ExtractSection } from "./PreviewScreen";
import { RoleScreen, type DraftResult } from "./RoleScreen";
import { RubricScreen } from "./RubricScreen";
import { SignInScreen } from "./SignInScreen";

const tokenStore = chromeTokenStore();
const api = createApi(API_BASE_URL, tokenStore);

function titleFromNotes(notes: string) {
  const line = notes.split(/[\n.]/)[0]?.trim() ?? "";
  return line.slice(0, 80) || "Role";
}

export function App() {
  const [screen, setScreen] = useState<"boot" | "signin" | "role" | "rubric" | "preview">("boot");
  const [error, setError] = useState<string | undefined>();
  const [role, setRole] = useState<{ id: string; title: string } | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [rubricId, setRubricId] = useState<string | null>(null);
  const [extract, setExtract] = useState<{ url: string; sections: ExtractSection[] } | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await tokenStore.get();
      if (!token) {
        setScreen("signin");
        return;
      }
      try {
        await api.me();
        setScreen("role");
      } catch {
        setScreen("signin");
      }
    })();
  }, []);

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
      async approveRubric(criteria: DraftResult["criteria"]) {
        if (!role) throw new Error("missing role");
        const approved = await api.approveRubric(role.id, criteria);
        setRubricId(approved.id);
        return approved;
      },
    }),
    [role],
  );

  const previewApi = useMemo(
    () => ({
      async evaluate(body: { approvedText: string; comparisonEnabled: boolean; keepExtracts: boolean }) {
        if (!role || !rubricId) throw new Error("missing rubric");
        return api.evaluate({
          roleId: role.id,
          rubricVersionId: rubricId,
          ...body,
        });
      },
    }),
    [role, rubricId],
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
        error={error}
        onSubmit={async (email, password) => {
          try {
            await api.login(email, password);
            setError(undefined);
            setScreen("role");
          } catch {
            setError("Sign in failed");
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
    return <PreviewOrMissing extract={extract} roleTitle={role?.title ?? ""} api={previewApi} />;
  }
  return null;
}

function PreviewOrMissing({
  extract,
  roleTitle,
  api,
}: {
  extract: { url: string; sections: ExtractSection[] } | null;
  roleTitle: string;
  api: {
    evaluate: (body: {
      approvedText: string;
      comparisonEnabled: boolean;
      keepExtracts: boolean;
    }) => Promise<unknown>;
  };
}) {
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
      roleTitle={roleTitle}
      sections={extract.sections}
      api={api}
      onEvaluated={() => undefined}
    />
  );
}
