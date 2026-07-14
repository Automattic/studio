import path from 'path';
import type { WindowsSignOptions } from '@electron/packager';

// Azure Trusted Signing configuration for Windows code signing.
//
// Uses a custom hook module because the default @electron/windows-sign
// dual-signs (SHA1 + SHA256), but Azure only supports SHA256.
//
// Gated on SIGN_WINDOWS_BUILD: signed-build jobs set it, package-only jobs
// (e.g. the Windows E2E run, which uses `electron-forge package`) leave it
// unset and get undefined, so this config stays inert there. The throw exists
// because a build that asked to sign but is missing its Azure env would
// otherwise fail with an opaque signtool exit code.
function getWindowsSign(): WindowsSignOptions | undefined {
	const signWindows = [ '1', 'true' ].includes(
		( process.env.SIGN_WINDOWS_BUILD ?? '' ).trim().toLowerCase()
	);

	if ( ! signWindows ) {
		return undefined;
	}

	if (
		! process.env.AZURE_CODE_SIGNING_DLIB ||
		! process.env.AZURE_METADATA_JSON ||
		! process.env.SIGNTOOL_PATH
	) {
		throw new Error(
			'SIGN_WINDOWS_BUILD is set but Azure signing env vars ' +
				'(AZURE_CODE_SIGNING_DLIB, AZURE_METADATA_JSON, SIGNTOOL_PATH) are missing. ' +
				'Did setup_azure_trusted_signing.ps1 run?'
		);
	}

	return {
		hookModulePath: path.resolve( __dirname, '..', '..', 'scripts', 'azure-sign-hook.cjs' ),
	};
}

export const windowsSign = getWindowsSign();
