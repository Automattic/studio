import type { WindowsSignOptions } from '@electron/packager';

// Azure Trusted Signing configuration for Windows code signing.
// These env vars are set by the CI build script (build-for-windows.ps1).
// On non-Windows platforms, this config is imported but never used.
export const windowsSign: WindowsSignOptions | undefined =
	process.env.AZURE_CODE_SIGNING_DLIB && process.env.AZURE_METADATA_JSON
		? {
				...( process.env.SIGNTOOL_PATH
					? { signToolPath: process.env.SIGNTOOL_PATH }
					: {} ),
				// Only Azure-specific flags here; the library adds /fd, /tr, /td automatically.
				signWithParams: `/v /debug /dlib ${ process.env.AZURE_CODE_SIGNING_DLIB } /dmdf ${ process.env.AZURE_METADATA_JSON }`,
				timestampServer: 'http://timestamp.acs.microsoft.com',
			}
		: undefined;
