import { __, _n, sprintf } from '@wordpress/i18n';

export const STATIC_SITE_IMPORT_RECEIPT_SCHEMA = 'static-site-importer/import-cli-receipt/v1';

export function decodeStaticSiteImportReceipt(
	output: string
): Record< string, unknown > | undefined {
	const lines = output.trim().split( /\r?\n/ );
	for ( let index = lines.length - 1; index >= 0; index-- ) {
		try {
			const receipt = JSON.parse( lines[ index ] );
			if ( receipt && typeof receipt === 'object' && ! Array.isArray( receipt ) ) {
				return receipt as Record< string, unknown >;
			}
		} catch {
			// WP-CLI may print informational lines before the terminal JSON receipt.
		}
	}
	return undefined;
}

export function staticSiteImportReceiptError(
	receipt: Record< string, unknown > | undefined
): string {
	const response = receipt?.response;
	if ( ! response || typeof response !== 'object' || Array.isArray( response ) ) {
		return '';
	}
	const error = ( response as Record< string, unknown > ).error;
	if ( ! error || typeof error !== 'object' || Array.isArray( error ) ) {
		return '';
	}
	const code = ( error as Record< string, unknown > ).code;
	const message = ( error as Record< string, unknown > ).message;
	const detail = [ code, message ]
		.filter( ( value ) => typeof value === 'string' && value )
		.join( ': ' );
	if ( code === 'static_site_importer_quality_failed' ) {
		return sprintf(
			/* translators: %s: Static Site Importer quality validation detail */
			__(
				'Static Site Importer materialized a preview but did not accept it. The site and staged request were preserved: %s'
			),
			detail || __( 'Quality validation failed.' )
		);
	}
	return detail;
}

function staticSiteImportResult(
	receipt: Record< string, unknown > | undefined
): Record< string, unknown > | undefined {
	const response = receipt?.response;
	if ( ! response || typeof response !== 'object' || Array.isArray( response ) ) {
		return undefined;
	}
	const result = ( response as Record< string, unknown > ).result;
	if ( result && typeof result === 'object' && ! Array.isArray( result ) ) {
		return result as Record< string, unknown >;
	}
	return response as Record< string, unknown >;
}

export function staticSiteImportQualityFailure(
	receipt: Record< string, unknown > | undefined
): string | undefined {
	const importResult = staticSiteImportResult( receipt );
	if ( ! importResult ) {
		return undefined;
	}
	const validation = importResult.import_validation_result;
	const summary = importResult.import_report_summary;
	const quality =
		validation && typeof validation === 'object' && ! Array.isArray( validation )
			? validation
			: summary && typeof summary === 'object' && ! Array.isArray( summary )
			? summary
			: undefined;
	if ( ! quality ) {
		return undefined;
	}
	const counts = ( quality as Record< string, unknown > ).counts;
	const {
		status,
		quality_pass: qualityPass,
		fail_import: failImport,
		fallback_count: fallbackCount,
		failure_reasons: failureReasons,
	} = quality as Record< string, unknown >;
	if ( status !== 'failed' && qualityPass !== false && failImport !== true ) {
		return undefined;
	}
	const failures = Array.isArray( failureReasons )
		? failureReasons.filter(
				( reason ): reason is string => typeof reason === 'string' && Boolean( reason )
		  )
		: [];
	const fallbackBlocks =
		counts && typeof counts === 'object' && ! Array.isArray( counts )
			? ( counts as Record< string, unknown > ).fallback_blocks
			: fallbackCount;
	const detail = failures.length
		? failures
				.map( ( reason ) => {
					const count = ( quality as Record< string, unknown > )[ `${ reason }_count` ];
					return typeof count === 'number'
						? sprintf(
								/* translators: 1: number of failures, 2: Static Site Importer failure reason */
								_n( 'SSI reported %1$d %2$s failure.', 'SSI reported %1$d %2$s failures.', count ),
								count,
								reason
						  )
						: sprintf(
								/* translators: %s: Static Site Importer failure reason */
								__( 'SSI reported a %s failure.' ),
								reason
						  );
				} )
				.join( ' ' )
		: typeof fallbackBlocks === 'number'
		? sprintf(
				/* translators: %d: number of fallback blocks */
				__( 'SSI reported %d fallback blocks.' ),
				fallbackBlocks
		  )
		: __( 'SSI rejected the imported content.' );
	return sprintf(
		/* translators: %s: Static Site Importer validation detail */
		__( '%s Review the importer diagnostics and retry.' ),
		detail
	);
}
