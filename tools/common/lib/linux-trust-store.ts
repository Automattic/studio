import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFilePromise = promisify( execFile );

export const LINUX_SYSTEM_CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';
export const LINUX_TRUST_STORE_PATH = '/usr/local/share/ca-certificates/studio-ca.crt';

/**
 * Check whether the given root CA is trusted by the Debian/Ubuntu system trust
 * bundle (`/etc/ssl/certs/ca-certificates.crt`). This is the bundle consulted
 * by curl, wget, Node, OpenSSL, and most apt-installed browsers.
 */
export async function isCATrustedOnLinux( caPath: string ): Promise< boolean > {
	try {
		await execFilePromise( 'openssl', [ 'verify', '-CAfile', LINUX_SYSTEM_CA_BUNDLE, caPath ] );
		return true;
	} catch {
		return false;
	}
}

/**
 * Build the shell command used (via sudo-prompt → pkexec) to install a CA
 * into the system trust store. Copies the CA into
 * `/usr/local/share/ca-certificates/` (the conventional location for
 * locally-administered roots on Debian/Ubuntu) and then runs
 * `update-ca-certificates`, which appends the cert to the system bundle.
 */
export function buildLinuxTrustInstallCommand( caPath: string ): string {
	return `install -m 0644 "${ caPath }" "${ LINUX_TRUST_STORE_PATH }" && update-ca-certificates`;
}
