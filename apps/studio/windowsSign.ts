import path from 'path';
import type { WindowsSignOptions } from '@electron/packager';

// Azure Trusted Signing configuration for Windows code signing.
//
// Uses a custom hook module because the default @electron/windows-sign
// dual-signs (SHA1 + SHA256), but Azure only supports SHA256.
// The hook calls signtool directly with SHA256-only parameters.
//
// Returns the signing config when the Azure env vars are present,
// `undefined` for local dev builds (signing is optional there), or
// throws in CI so unsigned builds never slip through silently.
function getWindowsSign(): WindowsSignOptions | undefined {
	if ( process.env.AZURE_CODE_SIGNING_DLIB && process.env.AZURE_METADATA_JSON ) {
		return {
			hookModulePath: path.resolve( __dirname, '..', '..', 'scripts', 'azure-sign-hook.js' ),
		};
	}

	if ( process.env.CI ) {
		throw new Error(
			'Azure signing env vars (AZURE_CODE_SIGNING_DLIB, AZURE_METADATA_JSON) ' +
				'are required in CI. Did setup_azure_trusted_signing.ps1 run?'
		);
	}

	return undefined;
}

export const windowsSign = getWindowsSign();
