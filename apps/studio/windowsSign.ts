import path from 'path';
import type { WindowsSignOptions } from '@electron/packager';

// Azure Trusted Signing configuration for Windows code signing.
//
// Uses a custom hook module because the default @electron/windows-sign
// dual-signs (SHA1 + SHA256), but Azure only supports SHA256.
// The hook calls signtool directly with SHA256-only parameters.
//
// Controlled by the USE_AZURE_TRUSTED_SIGNING env var:
// - Unset or not '1'/'true': returns undefined, letting Forge use PFX certificate signing.
// - '1' or 'true': returns the Azure signing hook config, or throws if the
//   required Azure env vars are missing.
function getWindowsSign(): WindowsSignOptions | undefined {
	const useAzureSigning = [ '1', 'true' ].includes(
		( process.env.USE_AZURE_TRUSTED_SIGNING ?? '' ).trim().toLowerCase()
	);

	if ( ! useAzureSigning ) {
		return undefined;
	}

	if ( ! process.env.AZURE_CODE_SIGNING_DLIB || ! process.env.AZURE_METADATA_JSON ) {
		throw new Error(
			'USE_AZURE_TRUSTED_SIGNING is set but Azure signing env vars ' +
				'(AZURE_CODE_SIGNING_DLIB, AZURE_METADATA_JSON) are missing. ' +
				'Did setup_azure_trusted_signing.ps1 run?'
		);
	}

	return {
		hookModulePath: path.resolve( __dirname, '..', '..', 'scripts', 'azure-sign-hook.js' ),
	};
}

export const windowsSign = getWindowsSign();
