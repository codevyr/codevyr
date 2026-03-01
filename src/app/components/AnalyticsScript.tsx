'use client';

import Script from 'next/script';
import { getRuntimeEnv } from '../lib/runtime_env';

export default function AnalyticsScript() {
  const runtimeEnv = getRuntimeEnv();
  const isEnabled =
    runtimeEnv?.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true' ||
    process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true';

  if (!isEnabled) {
    return null;
  }

  return (
    <Script
      defer
      data-domain="ui.codevyr.com"
      src="https://plausible.codevyr.com/js/script.js"
    />
  );
}
