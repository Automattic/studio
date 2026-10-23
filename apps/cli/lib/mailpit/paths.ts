/**
 * Catches the email every Studio site sends.
 *
 * PHP's `mail()` hands each message to the `sendmail_path` command. Left at PHP's
 * default it reaches a sendmail no local machine has set up, so the message is
 * dropped while `mail()` still reports success. Studio points `sendmail_path` at
 * Mailpit's sendmail mode instead, which passes the message unchanged to one
 * shared Mailpit server: an inbox every site's email lands in.
 */
import fs from 'fs';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { z } from 'zod';

export const MAILPIT_VERSION = 'v1.32.0';

const portsSchema = z.object( { httpPort: z.number().int(), smtpPort: z.number().int() } );
type MailpitPorts = z.infer< typeof portsSchema >;

export function getMailpitDir(): string {
	return path.join( getConfigDirectory(), 'mailpit' );
}

export function getPortsPath(): string {
	return path.join( getMailpitDir(), 'ports.json' );
}

// Beside the PHP binaries Studio downloads (`php-bin`), apart from the inbox's data.
export function getMailpitBinaryPath(): string {
	return path.join(
		getConfigDirectory(),
		'mailpit-bin',
		MAILPIT_VERSION,
		process.platform === 'win32' ? 'mailpit.exe' : 'mailpit'
	);
}

export function readPorts(): MailpitPorts | undefined {
	try {
		return portsSchema.parse( JSON.parse( fs.readFileSync( getPortsPath(), 'utf8' ) ) );
	} catch {
		return undefined;
	}
}

/**
 * The `sendmail_path` that sends a site's email to Studio's inbox, or `undefined`
 * before Mailpit has been set up.
 */
export function getMailpitSendmailCommand(): string | undefined {
	const ports = readPorts();
	const binaryPath = getMailpitBinaryPath();
	if ( ! ports || ! fs.existsSync( binaryPath ) ) {
		return undefined;
	}
	return `"${ binaryPath }" sendmail -S 127.0.0.1:${ ports.smtpPort }`;
}

export function getMailpitInboxUrl(): string | undefined {
	const ports = readPorts();
	return ports ? `http://127.0.0.1:${ ports.httpPort }` : undefined;
}
