import type { Blueprint } from '@wp-playground/blueprints';
import type { RunCLIArgs } from '@wp-playground/cli';

/**
 * Sanitizes a Blueprint step to remove sensitive data while keeping useful debugging info.
 */
function sanitizeBlueprintStep( step: Blueprint[ 'steps' ][ number ] ): Record< string, unknown > {
	const baseStep: Record< string, unknown > = { step: step.step };
	const stepRecord = step as Record< string, unknown >;

	// For steps that might contain secrets, only include safe fields
	switch ( step.step ) {
		case 'login':
			// Omit login details, indicate it exists
			return { ...baseStep, hasLogin: true };

		case 'runPHP':
		case 'runPHPWithOptions':
			// Omit code (might contain secrets), indicate it exists
			return { ...baseStep, hasCode: !! stepRecord.code };

		case 'defineWpConfigConsts':
			// Omit actual constants (might contain DB credentials, auth keys)
			return {
				...baseStep,
				constCount:
					stepRecord.consts && typeof stepRecord.consts === 'object'
						? Object.keys( stepRecord.consts as object ).length
						: 0,
			};

		case 'runSql':
			// Omit SQL (might contain sensitive data)
			return { ...baseStep, hasSql: !! stepRecord.sql };

		case 'writeFile':
			// Keep path for debugging, omit file content
			return {
				...baseStep,
				path: stepRecord.path,
				hasData: !! stepRecord.data,
			};

		case 'request':
			// Keep URL and method, omit headers and body (might contain auth tokens)
			return {
				...baseStep,
				url:
					stepRecord.request && typeof stepRecord.request === 'object'
						? ( stepRecord.request as Record< string, unknown > ).url
						: undefined,
				method:
					stepRecord.request && typeof stepRecord.request === 'object'
						? ( stepRecord.request as Record< string, unknown > ).method
						: undefined,
			};

		case 'setSiteOptions':
		case 'updateUserMeta': {
			// Keep option/meta keys but not values (values might be API keys)
			let keys: string[] = [];
			if ( stepRecord.options && typeof stepRecord.options === 'object' ) {
				keys = Object.keys( stepRecord.options as object );
			} else if ( stepRecord.meta && typeof stepRecord.meta === 'object' ) {
				keys = Object.keys( stepRecord.meta as object );
			}
			return {
				...baseStep,
				keys,
			};
		}

		case 'installPlugin':
		case 'installTheme':
			// These are safe - just WordPress.org slugs or URLs
			return step as Record< string, unknown >;

		default:
			// For other steps, include everything (they're generally safe)
			return step as Record< string, unknown >;
	}
}

/**
 * Sanitizes a Blueprint object to remove sensitive data (passwords, tokens, code)
 * while preserving useful debugging information.
 */
export function sanitizeBlueprint( blueprint: Blueprint | undefined ): object | undefined {
	if ( ! blueprint ) {
		return undefined;
	}

	return {
		// Keep metadata but omit author (triggers Sentry's "auth" filter)
		meta: blueprint.meta
			? {
					title: blueprint.meta.title,
					description: blueprint.meta.description,
			  }
			: undefined,

		// Sanitize each step individually
		steps: blueprint.steps?.map( sanitizeBlueprintStep ),

		// Safe configuration
		features: blueprint.features,
		preferredVersions: blueprint.preferredVersions,
		landingPage: blueprint.landingPage,
		login: typeof blueprint.login === 'boolean' ? blueprint.login : '<credentials>',
	};
}

/**
 * Sanitizes RunCLIArgs to remove only truly sensitive data (passwords, tokens)
 * while preserving configuration useful for debugging local development issues.
 * Prepares data for Sentry by stringifying nested objects to avoid normalization limits.
 */
export function sanitizeRunCLIArgs( args: RunCLIArgs ): Record< string, unknown > {
	return {
		command: args.command,
		php: args.php,
		wp: args.wp,
		port: args.port,
		debug: args.debug,
		verbosity: args.verbosity,
		wordpressInstallMode: args.wordpressInstallMode,
		skipSqliteSetup: args.skipSqliteSetup,
		followSymlinks: args.followSymlinks,
		internalCookieStore: args.internalCookieStore,
		xdebug: args.xdebug,
		experimentalDevtools: args.experimentalDevtools,
		'site-url': args[ 'site-url' ],
		outfile: args.outfile,
		blueprintJson: args.blueprint
			? JSON.stringify( sanitizeBlueprint( args.blueprint ) )
			: undefined,
	};
}
