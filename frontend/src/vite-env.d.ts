/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
  readonly VITE_STATIC?: string;
  readonly VITE_STATIC_SAVED?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
