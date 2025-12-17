/**
 * Local type definitions for WordPress Playground blueprints.
 * These replace imports from @wp-playground/blueprints to avoid bundling PHP-WASM in the desktop app.
 *
 * Note: These are simplified versions of the upstream types, containing only the fields
 * actually used by Studio. Keep them in sync with @wp-playground/blueprints if needed.
 */

import type { SupportedPHPVersion } from './php-versions';

/**
 * Extra libraries that can be preloaded into the Playground instance.
 */
export type ExtraLibrary = 'wp-cli';

/**
 * PHP Constants to define on every request.
 */
export type PHPConstants = Record< string, string | boolean | number >;

/**
 * Reference to a file resource.
 * Simplified version - the full type supports various resource types.
 */
export type FileReference =
	| { resource: 'url'; url: string }
	| { resource: 'vfs'; path: string }
	| { resource: 'literal'; name: string; contents: string | Uint8Array }
	| { resource: 'wordpress.org/themes'; slug: string }
	| { resource: 'wordpress.org/plugins'; slug: string };

/**
 * Step definition for a blueprint.
 * This is a simplified union of the most commonly used step types in Studio.
 */
export type StepDefinition = {
	step: string;
	progress?: {
		weight?: number;
		caption?: string;
	};
} & Record< string, unknown >;

/**
 * Blueprint V1 declaration.
 * Simplified version containing only fields used by Studio.
 */
export type BlueprintV1Declaration = {
	/**
	 * The URL to navigate to after the blueprint has been run.
	 */
	landingPage?: string;

	/**
	 * Optional description.
	 * @deprecated Use meta.description instead.
	 */
	description?: string;

	/**
	 * Optional metadata.
	 */
	meta?: {
		title: string;
		description?: string;
		author: string;
		categories?: string[];
	};

	/**
	 * The preferred PHP and WordPress versions to use.
	 */
	preferredVersions?: {
		php: SupportedPHPVersion | 'latest';
		wp: string | 'latest';
	};

	/**
	 * Feature flags.
	 */
	features?: {
		intl?: boolean;
		networking?: boolean;
	};

	/**
	 * Extra libraries to preload.
	 */
	extraLibraries?: ExtraLibrary[];

	/**
	 * PHP Constants to define on every request.
	 */
	constants?: PHPConstants;

	/**
	 * WordPress plugins to install and activate.
	 */
	plugins?: Array< string | FileReference >;

	/**
	 * WordPress site options to define.
	 */
	siteOptions?: Record< string, string > & {
		blogname?: string;
	};

	/**
	 * User to log in as.
	 */
	login?:
		| boolean
		| {
				username: string;
				password: string;
		  };

	/**
	 * The steps to run after every other operation in this Blueprint.
	 */
	steps?: Array< StepDefinition | string | undefined | false | null >;
};

/**
 * Blueprint type alias - can be a declaration or a bundle.
 * In Studio, we primarily use the declaration form.
 */
export type Blueprint = BlueprintV1Declaration;
