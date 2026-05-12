import { z } from 'zod';

export const MAILPIT_VERSION = 'v1.29.7';
export const MAILPIT_HTTP_PORT_START = 8025;
export const MAILPIT_SMTP_PORT_START = 1025;

export const mailpitSchema = z.object( {
	enabled: z.boolean(),
	httpPort: z.number().int().positive(),
	smtpPort: z.number().int().positive(),
} );

export type MailpitConfig = z.infer< typeof mailpitSchema >;

export function getMailpitBinaryName( platform: NodeJS.Platform ): string {
	return platform === 'win32' ? 'mailpit.exe' : 'mailpit';
}

export function getMailpitInstallDirName( platform: NodeJS.Platform, arch: string ): string {
	return `${ platform }-${ arch }`;
}

export function getMailpitReleaseAssetName( platform: NodeJS.Platform, arch: string ): string {
	const releaseArch = arch === 'x64' ? 'amd64' : arch;

	switch ( platform ) {
		case 'darwin':
			return `mailpit-darwin-${ releaseArch }.tar.gz`;
		case 'linux':
			return `mailpit-linux-${ releaseArch }.tar.gz`;
		case 'win32':
			return `mailpit-windows-${ releaseArch }.zip`;
		default:
			throw new Error( `Unsupported MailPit platform: ${ platform }` );
	}
}
