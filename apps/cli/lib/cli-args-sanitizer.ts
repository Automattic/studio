import {
	isStepDefinition,
	type BlueprintV1Declaration,
	type StepDefinition,
} from '@wp-playground/blueprints';
import type { RunCLIArgs } from '@wp-playground/cli';

/**
 * Sanitizes a Blueprint step to remove sensitive data while keeping useful debugging info.
 */
function sanitizeBlueprintStep( step: StepDefinition ): unknown {
	const baseStep: Record< string, unknown > = { step: step.step };

	// For steps that might contain secrets, only include safe fields
	switch ( step.step ) {
		case 'login':
			// Omit login details, indicate it exists
			return { ...baseStep, hasLogin: true };

		case 'runPHP':
		case 'runPHPWithOptions':
			// Omit code (might contain secrets), indicate it exists
			return { ...baseStep, hasCode: 'code' in step };

		case 'defineWpConfigConsts':
			// Omit actual constants (might contain DB credentials, auth keys)
			return {
				...baseStep,
				constCount: 'consts' in step ? Object.keys( step.consts ).length : undefined,
			};

		case 'runSql':
			// Omit SQL (might contain sensitive data)
			return { ...baseStep, hasSql: 'sql' in step };

		case 'writeFile':
			// Keep path for debugging, omit file content
			return {
				...baseStep,
				path: 'path' in step ? step.path : undefined,
				hasData: 'data' in step,
			};

		case 'request':
			// Keep URL and method, omit headers and body (might contain auth tokens)
			return {
				...baseStep,
				url: 'request' in step ? step.request.url : undefined,
				method: 'request' in step ? step.request.method : undefined,
			};

		case 'setSiteOptions':
		case 'updateUserMeta': {
			// Keep option/meta keys but not values (values might be API keys)
			let keys: string[] = [];
			if ( 'options' in step && step.options ) {
				keys = Object.keys( step.options );
			} else if ( 'meta' in step ) {
				keys = Object.keys( step.meta );
			}
			return {
				...baseStep,
				keys,
			};
		}

		case 'installPlugin':
		case 'installTheme':
			// These are safe - just WordPress.org slugs or URLs
			return step;

		default:
			// For other steps, include everything (they're generally safe)
			return step;
	}
}

/**
 * Sanitizes a Blueprint object to remove sensitive data (passwords, tokens, code)
 * while preserving useful debugging information.
 */
export function sanitizeBlueprint(
	blueprint: Partial< BlueprintV1Declaration > | undefined
): object | undefined {
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
		steps: blueprint.steps?.filter( isStepDefinition ).map( sanitizeBlueprintStep ),

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
			? // This isn't a fully safe type assertion, but by the time we execute this, the blueprint
			  // content will already have been validated to conform to the V1 spec, so it's fine.
			  JSON.stringify( sanitizeBlueprint( args.blueprint as BlueprintV1Declaration ) )
			: undefined,
	};
}
