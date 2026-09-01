export interface Bindings {
  DB: D1Database;
  ADMIN_KEY: string;
  /** Public base URL of this tool, used to build the client assertion audience. */
  TOOL_URL: string;
}

export interface AppEnv {
  Bindings: Bindings;
}
