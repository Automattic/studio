import { execFileSync } from 'child_process';
import {
	getConfiguredPhpBinaryPackageId,
	resolveNativePhpVersion,
} from '@studio/common/lib/php-binary-metadata';
import { getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import { getNativePhpIniPath } from 'cli/lib/native-php/config';

export function assertNativePhpZstdAvailable(
	phpVersion: string,
	runPhp: typeof execFileSync = execFileSync
): void {
	const nativePhpVersion = resolveNativePhpVersion( phpVersion );
	try {
		runPhp( getPhpBinaryPath( nativePhpVersion ), [
			'-c',
			getNativePhpIniPath( nativePhpVersion ),
			'-r',
			'exit(function_exists("zstd_uncompress") ? 0 : 1);',
		] );
	} catch {
		const packageId = getConfiguredPhpBinaryPackageId( nativePhpVersion ) ?? nativePhpVersion;
		throw new Error(
			`Native PHP package ${ packageId } does not provide zstd_uncompress. ` +
				'Figma import requires a published native PHP package whose metadata declares the zstd capability and whose runtime provides zstd_uncompress.'
		);
	}
}
