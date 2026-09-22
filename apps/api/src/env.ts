export type Env = {
  accountEmail: string;
  accountPassword: string;
  evaluationsEnabled: boolean;
  port: number;
};

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    accountEmail: source.ACCOUNT_EMAIL ?? "",
    accountPassword: source.ACCOUNT_PASSWORD ?? "",
    evaluationsEnabled: source.EVALUATIONS_ENABLED !== "false",
    port: Number(source.PORT ?? 8787),
  };
}
