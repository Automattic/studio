import { runCliCommand, type ExecuteCliCommand } from '@studio/common/lib/cli-process';
import {
	spacefastConnectionSchema,
	type SpacefastConnection,
	type SpacefastPublishTarget,
} from '@studio/common/types/spacefast';

/**
 * Exports the site as static files and publishes them to a Spacefast Space (creating it first
 * when the target asks for a new one), via `studio spacefast publish`. The command publishes its
 * progress as `spacefast` sync activity and resolves with the Space the site now publishes to.
 */
export function publishSiteToSpacefast(
	executeCliCommand: ExecuteCliCommand,
	sitePath: string,
	target: SpacefastPublishTarget
): Promise< SpacefastConnection > {
	const targetArgs =
		'spaceId' in target
			? [ '--space', target.spaceId ]
			: [ '--new-space', target.title, '--team', target.teamId ];
	return runCliCommand(
		executeCliCommand,
		[ 'spacefast', 'publish', '--path', sitePath, ...targetArgs ],
		spacefastConnectionSchema,
		{ logPrefix: 'spacefast' }
	);
}
