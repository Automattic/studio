import type { Blueprint } from './validate';
import type { StepDefinition } from '@wp-playground/blueprints';

/** What a Blueprint asks for, in the Blueprint's and WordPress's own terms. */
export interface BlueprintDetails {
	title?: string;
	description?: string;
	phpVersion?: string;
	wpVersion?: string;
	siteTitle?: string;
	siteUrl?: string;
	login?: { username?: string; password?: string };
	multisite: boolean;
}

function getSteps( blueprint: Blueprint ): StepDefinition[] {
	return ( blueprint.steps ?? [] ).filter( ( step ): step is StepDefinition =>
		Boolean( step && typeof step === 'object' )
	);
}

export function inspectBlueprint( blueprint: Blueprint ): BlueprintDetails {
	const steps = getSteps( blueprint );
	const meta = blueprint.meta as { title?: string; description?: string } | undefined;
	const details: BlueprintDetails = {
		title: meta?.title || undefined,
		description: meta?.description || undefined,
		phpVersion: blueprint.preferredVersions?.php || undefined,
		wpVersion: blueprint.preferredVersions?.wp || undefined,
		multisite: steps.some( ( step ) => step.step === 'enableMultisite' ),
	};

	const blogname = [
		blueprint.siteOptions,
		...steps.map( ( step ) => step.step === 'setSiteOptions' && step.options ),
	]
		.map( ( options ) => ( options ? options.blogname : undefined ) )
		.filter( ( name ) => name !== undefined && name !== '' )
		.pop();
	if ( blogname !== undefined ) {
		details.siteTitle = String( blogname );
	}

	const defineSiteUrl = steps.find( ( step ) => step.step === 'defineSiteUrl' );
	if ( defineSiteUrl?.siteUrl ) {
		details.siteUrl = defineSiteUrl.siteUrl;
	}

	const loginStep = steps.find( ( step ) => step.step === 'login' );
	const login = typeof blueprint.login === 'object' ? blueprint.login : loginStep;
	if ( login ) {
		details.login = {
			username: typeof login.username === 'string' ? login.username : undefined,
			password: typeof login.password === 'string' ? login.password : undefined,
		};
	}

	return details;
}

/**
 * Returns a copy of the Blueprint with the given details changed. Only details the Blueprint
 * already sets are changed, so it never gains steps or options it didn't ask for.
 */
export function customizeBlueprint(
	blueprint: Blueprint,
	changes: Pick< BlueprintDetails, 'phpVersion' | 'wpVersion' | 'siteTitle' | 'siteUrl' >
): Blueprint {
	const customized = structuredClone( blueprint );
	const { preferredVersions } = customized;
	if ( preferredVersions && changes.phpVersion ) {
		preferredVersions.php = changes.phpVersion as typeof preferredVersions.php;
	}
	if ( preferredVersions && changes.wpVersion ) {
		preferredVersions.wp = changes.wpVersion;
	}

	for ( const step of getSteps( customized ) ) {
		if ( step.step === 'defineSiteUrl' && changes.siteUrl ) {
			step.siteUrl = changes.siteUrl;
		}
		if (
			step.step === 'setSiteOptions' &&
			step.options?.blogname !== undefined &&
			changes.siteTitle
		) {
			step.options.blogname = changes.siteTitle;
		}
	}
	if ( customized.siteOptions?.blogname !== undefined && changes.siteTitle ) {
		customized.siteOptions.blogname = changes.siteTitle;
	}

	return customized;
}
