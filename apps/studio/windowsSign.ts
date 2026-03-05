import path from 'path';
import type { WindowsSignOptions } from '@electron/packager';

// Azure Trusted Signing configuration for Windows code signing.
// Uses a custom hook module because the default @electron/windows-sign
// dual-signs (sha1 + sha256), but Azure only supports SHA256.
// The hook calls signtool directly with SHA256-only parameters.
export const windowsSign: WindowsSignOptions | undefined =
	process.env.AZURE_CODE_SIGNING_DLIB && process.env.AZURE_METADATA_JSON
		? {
				hookModulePath: path.resolve( __dirname, '..', '..', 'scripts', 'azure-sign-hook.js' ),
			}
		: undefined;
