import { SupportedPHPVersions, type SupportedPHPVersion } from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

export function validateSupportedPhpVersion( version: string ): SupportedPHPVersion {
	const result = z.enum( SupportedPHPVersions ).safeParse( version );
	if ( ! result.success ) {
		throw new LoggerError(
			sprintf(
				__( 'PHP %1$s is not supported. Supported versions: %2$s.' ),
				version,
				SupportedPHPVersions.join( ', ' )
			)
		);
	}
	return result.data;
}
