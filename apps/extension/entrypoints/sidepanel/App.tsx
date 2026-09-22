import { useEffect, useState } from "react";
import { API_BASE_URL, chromeTokenStore, createApi } from "../../src/api";
import { SignInScreen } from "./SignInScreen";

const api = createApi(API_BASE_URL, chromeTokenStore());

export function App() {
  const [screen, setScreen] = useState<"boot" | "signin" | "role">("boot");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void (async () => {
      const token = await chromeTokenStore().get();
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

  return (
    <section>
      <h1>Create a role</h1>
    </section>
  );
}
