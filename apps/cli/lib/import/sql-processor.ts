/**
 * SQL Processor for Imported Database Dumps
 *
 * The streaming site migration protocol encodes all SQL values using
 * MySQL's FROM_BASE64() function to avoid charset corruption during
 * transfer. Studio uses SQLite (via the WordPress SQLite Database
 * Integration plugin), which does not support FROM_BASE64().
 *
 * This processor decodes every FROM_BASE64('...') call into a plain
 * SQL string literal, and optionally renames the table prefix so the
 * imported tables match the local WordPress configuration.
 */

/**
 * Decodes a base64 string and returns a properly escaped SQL literal.
 * If the decoded bytes are valid UTF-8, they become a quoted string
 * with single quotes escaped. Binary data falls back to X'hex' syntax.
 */
function decodeBase64ToSqlLiteral( base64Value: string ): string {
	const buffer = Buffer.from( base64Value, 'base64' );
	const decoded = buffer.toString( 'utf-8' );

	// Verify the buffer round-trips through UTF-8 encoding. If it
	// doesn't, the original data contains bytes that are not valid
	// UTF-8 and we must use a hex literal instead.
	if ( Buffer.from( decoded, 'utf-8' ).equals( buffer ) ) {
		const escaped = decoded.replace( /'/g, "''" );
		return `'${ escaped }'`;
	}

	return `X'${ buffer.toString( 'hex' ) }'`;
}

/**
 * Processes a raw SQL dump from the migration API into SQL that is
 * compatible with the WordPress SQLite integration layer.
 *
 * Two transformations are applied:
 *
 * 1. CONVERT(FROM_BASE64('...') USING utf8mb4) → 'decoded_value'
 * 2. FROM_BASE64('...') → 'decoded_value'
 *
 * The CONVERT form appears for JSON columns where MySQL requires an
 * explicit charset annotation. Both are decoded to plain literals.
 */
export function processImportedSql( sql: string ): string {
	// First pass: handle CONVERT(FROM_BASE64('...') USING utf8mb4)
	let processed = sql.replace(
		/CONVERT\(FROM_BASE64\('([^']+)'\)\s+USING\s+utf8mb4\)/g,
		( _, base64 ) => decodeBase64ToSqlLiteral( base64 )
	);

	// Second pass: handle remaining FROM_BASE64('...')
	processed = processed.replace( /FROM_BASE64\('([^']+)'\)/g, ( _, base64 ) =>
		decodeBase64ToSqlLiteral( base64 )
	);

	return processed;
}

/**
 * Renames table references in SQL statements from one prefix to
 * another. Only touches backtick-quoted identifiers to avoid
 * accidentally modifying data values.
 */
export function renameTablePrefix( sql: string, oldPrefix: string, newPrefix: string ): string {
	if ( oldPrefix === newPrefix ) {
		return sql;
	}

	const escapedOldPrefix = oldPrefix.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
	return sql.replace( new RegExp( '`' + escapedOldPrefix, 'g' ), '`' + newPrefix );
}
