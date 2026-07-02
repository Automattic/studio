import { resolveSiteUrl } from '../import/resolve-site-url.js';

export interface WpSetupInput {
  site: string;
  username: string;
  token: string;
}

export interface WpSetupReport {
  siteUrl: string;
  siteReachable: boolean;
  restApiAvailable: boolean;
  authenticated: boolean;
  siteName: string;
  userName: string;
  errors: string[];
  guidance: string[];
}

export async function validateWpConnection(input: WpSetupInput): Promise<WpSetupReport> {
  const report: WpSetupReport = {
    siteUrl: '',
    siteReachable: false,
    restApiAvailable: false,
    authenticated: false,
    siteName: '',
    userName: '',
    errors: [],
    guidance: [],
  };

  try {
    report.siteUrl = await resolveSiteUrl(input.site);
  } catch {
    report.siteUrl = input.site;
  }

  const baseUrl = report.siteUrl;

  // Step 1: Check REST API endpoint
  try {
    const resp = await fetch(`${baseUrl}/wp-json`, {
      signal: AbortSignal.timeout(10000),
    });

    report.siteReachable = true;

    if (resp.ok) {
      const apiResponse = (await resp.json()) as { name?: string; namespaces?: string[] };
      report.restApiAvailable = true;
      report.siteName = apiResponse?.name || '';
    } else {
      report.restApiAvailable = false;
      report.errors.push(
        `REST API returned HTTP ${resp.status} — the REST API may be disabled or the URL may be wrong`
      );
    }
  } catch (err) {
    report.siteReachable = false;
    report.errors.push(`Could not reach ${baseUrl}: ${(err as Error).message}`);
    report.guidance.push(
      'Check that the site URL is correct and the site is accessible',
      'For WordPress.com sites, use the format: yoursite.wordpress.com',
      'For self-hosted sites, ensure the site is running and accessible from this machine',
    );
    return report;
  }

  if (!report.restApiAvailable) {
    report.guidance.push(
      'The site is reachable but the REST API is not responding',
      'For self-hosted sites: ensure the REST API is not disabled by a security plugin',
      'For WordPress.com sites: the REST API should be available by default',
      'Check that the URL points to a WordPress site (not a redirect or parking page)',
    );
    return report;
  }

  // Step 2: Authenticate
  try {
    const authHeader = 'Basic ' + btoa(`${input.username}:${input.token}`);
    const resp = await fetch(`${baseUrl}/wp-json/wp/v2/users/me`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Authorization': authHeader },
    });

    if (resp.ok) {
      const user = (await resp.json()) as { id?: number; name?: string };
      report.authenticated = true;
      report.userName = user?.name || input.username;
    } else {
      report.authenticated = false;
      report.errors.push(
        `Authentication failed (HTTP ${resp.status}) — check your username and application password`
      );
    }
  } catch (err) {
    report.errors.push(`Authentication request failed: ${(err as Error).message}`);
  }

  if (!report.authenticated) {
    const host = (() => {
      try { return new URL(baseUrl).hostname.toLowerCase(); } catch { return ''; }
    })();
    const isWpcomHost =
      host.endsWith('.wpcomstaging.com') ||
      host.endsWith('.wordpress.com') ||
      host === 'wordpress.com';

    if (isWpcomHost) {
      report.guidance.push(
        'This is a WordPress.com-hosted site. WordPress.com has TWO kinds of application passwords — only the site-specific one works for /wp-json/wp/v2/ Basic Auth:',
        `  → Generate one at ${baseUrl}/wp-admin/profile.php (Users > Profile > Application Passwords)`,
        'Account-level app passwords from wordpress.com/me/security/application-passwords only authenticate against the public-api.wordpress.com namespace (OAuth-style); they will 401 against the site-native REST API.',
        'The token should be the Application Password (with spaces), not your account password',
        'Username should be your WordPress.com login username, not your email',
      );
    } else {
      report.guidance.push(
        'Create an Application Password at: WordPress Admin > Users > Profile > Application Passwords',
        'The token should be the Application Password (with spaces), not your account password',
        'Username should be your WordPress login username, not your email',
      );
    }
  }

  return report;
}
