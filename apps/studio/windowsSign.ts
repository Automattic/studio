import path from 'path';
import type { WindowsSignOptions } from '@electron/packager';

// Azure Trusted Signing configuration for Windows code signing.
//
// Uses a custom hook module because the default @electron/windows-sign
// dual-signs (SHA1 + SHA256), but Azure only supports SHA256.
// The hook calls signtool directly with SHA256-only parameters.
//
// Gated on USE_AZURE_TRUSTED_SIGNING, which the signed-build jobs set (see
// build-for-windows.ps1). Package-only jobs — e.g. the Windows E2E run, which
// uses `electron-forge package` and never signs — leave it unset and get
// undefined, so this config (loaded by Forge on every build) stays inert
// there. The throw fires only for a build that asked to sign but is missing
// its Azure env, where signtool would otherwise fail with an opaque exit code.
function getWindowsSign(): WindowsSignOptions | undefined {
	const signWithAzure = [ '1', 'true' ].includes(
		( process.env.USE_AZURE_TRUSTED_SIGNING ?? '' ).trim().toLowerCase()
	);

	if ( ! signWithAzure ) {
		return undefined;
	}

	if ( ! process.env.AZURE_CODE_SIGNING_DLIB || ! process.env.AZURE_METADATA_JSON || ! process.env.SIGNTOOL_PATH ) {
		throw new Error(
			'USE_AZURE_TRUSTED_SIGNING is set but Azure signing env vars ' +
				'(AZURE_CODE_SIGNING_DLIB, AZURE_METADATA_JSON, SIGNTOOL_PATH) are missing. ' +
				'Did setup_azure_trusted_signing.ps1 run?'
		);
	}

	return {
		hookModulePath: path.resolve( __dirname, '..', '..', 'scripts', 'azure-sign-hook.js' ),
	};
}

export const windowsSign = getWindowsSign();
