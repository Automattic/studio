import { SupportedPHPVersions, SupportedPHPVersion } from '@php-wasm/universal';
import { __ } from '@wordpress/i18n';
import { generateYargsErrorMessage } from 'cli/lib/generate-yargs-error-message';
import { LoggerError } from 'cli/logger';

export function phpVersionValidator( value: string ): SupportedPHPVersion {
	// Type assertion is only for TypeScript's type checker
	const isValidVersion = ( SupportedPHPVersions as readonly string[] ).includes( value );

	if ( ! isValidVersion ) {
		throw new LoggerError(
			generateYargsErrorMessage( 'php', value, SupportedPHPVersions.join( ', ' ) )
		);
	}

	// After validation passes, we know value is a valid SupportedPHPVersion
	return value as SupportedPHPVersion;
}
