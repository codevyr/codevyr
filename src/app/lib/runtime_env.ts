export type RuntimeEnv = {
  NEXT_PUBLIC_ENABLE_ANALYTICS?: string;
  NEXT_PUBLIC_ASKLD_URL?: string;
};

export function getRuntimeEnv(): RuntimeEnv | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const env = (window as Window & { __RUNTIME_ENV__?: RuntimeEnv })
    .__RUNTIME_ENV__;

  return env ?? null;
}
