import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, chromeTokenStore, createApi } from "../../src/api";
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
  const [screen, setScreen] = useState<"boot" | "signin" | "role" | "rubric">("boot");
  const [error, setError] = useState<string | undefined>();
  const [role, setRole] = useState<{ id: string; title: string } | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);

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
        return api.approveRubric(role.id, criteria);
      },
    }),
    [role],
  );

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
  if (!draft) return null;
  return (
    <RubricScreen
      criteria={draft.criteria}
      omitted={draft.omitted}
      usage={draft.usage}
      cost={draft.cost}
      roleTitle={role?.title}
      api={rubricApi}
      onApproved={() => undefined}
    />
  );
}
