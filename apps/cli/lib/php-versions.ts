import { SupportedPHPVersions, type SupportedPHPVersion } from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

export function validateSupportedPhpVersion( version: string ): SupportedPHPVersion {
	if ( SupportedPHPVersions.includes( version as SupportedPHPVersion ) ) {
		return version as SupportedPHPVersion;
	}

	throw new LoggerError(
		sprintf(
			__( 'PHP %1$s is not supported. Supported versions: %2$s.' ),
			version,
			SupportedPHPVersions.join( ', ' )
		)
	);
}
