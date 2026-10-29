const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];

export function isAllowedOrigin(origin: string | undefined, appUrl: string, mode: string): boolean {
  if (!origin) return false;
  const configured = new URL(appUrl);
  if (origin === configured.origin) return true;
  if (mode !== 'development' || !loopbackHosts.includes(configured.hostname)) return false;
  // Vite prints 127.0.0.1 while local APP_URL commonly uses localhost. Trust only
  // these explicit aliases, with the same scheme and frontend port, during development.
  return loopbackHosts.some(host => origin === `${configured.protocol}//${host}${configured.port ? `:${configured.port}` : ''}`);
}
