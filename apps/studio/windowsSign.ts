import path from 'path';
import type { WindowsSignOptions } from '@electron/packager';

// Azure Trusted Signing configuration for Windows code signing.
//
// Uses a custom hook module because the default @electron/windows-sign
// dual-signs (SHA1 + SHA256), but Azure only supports SHA256.
// The hook calls signtool directly with SHA256-only parameters.
//
// Only signs on Windows CI. This config is loaded by Forge on every platform,
// so non-Windows builds (and local Windows builds) get undefined — returning
// the Azure config unconditionally would throw on Mac/Linux CI, where the
// Azure env vars are absent.
function getWindowsSign(): WindowsSignOptions | undefined {
	if ( ! process.env.CI || process.platform !== 'win32' ) {
		return undefined;
	}

	if ( ! process.env.AZURE_CODE_SIGNING_DLIB || ! process.env.AZURE_METADATA_JSON || ! process.env.SIGNTOOL_PATH ) {
		throw new Error(
			'Windows CI build is missing Azure Trusted Signing env vars ' +
				'(AZURE_CODE_SIGNING_DLIB, AZURE_METADATA_JSON, SIGNTOOL_PATH). ' +
				'Did setup_azure_trusted_signing.ps1 run?'
		);
	}

	return {
		hookModulePath: path.resolve( __dirname, '..', '..', 'scripts', 'azure-sign-hook.js' ),
	};
}

export const windowsSign = getWindowsSign();
