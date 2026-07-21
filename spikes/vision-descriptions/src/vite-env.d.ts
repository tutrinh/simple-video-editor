/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
