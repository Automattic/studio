import type {
	AiModelId,
	AiSessionSummary,
	Connector,
	StudioChatFileAttachment,
	StudioChatImage,
} from '@/data/core';

interface StartConcurrentDesignGenerationOptions {
	connector: Connector;
	siteId: string;
	brief: string;
	model: AiModelId;
	attachments: {
		images?: StudioChatImage[];
		files?: StudioChatFileAttachment[];
	};
}

interface StartedDesignGeneration {
	session: AiSessionSummary;
	sessionIds: string[];
	runIds: string[];
}

const DIRECTION_ASSIGNMENTS = [
	'Typography-led and editorial: prioritize hierarchy, rhythm, and a distinctive type system.',
	'Immersive and image-led: prioritize atmosphere, strong art direction, and an expressive hero composition.',
	'Modular and playful: prioritize an unexpected layout, energetic components, and memorable interaction cues.',
] as const;

function getWorkerPrompt( brief: string, workerIndex: number ): string {
	const slot = workerIndex + 1;
	return `Load site-creator and visual-design with the Skill tool. You are design worker ${ slot } of 3. Create exactly one homepage direction for the existing design project, then stop.

Your assigned exploration:
${ DIRECTION_ASSIGNMENTS[ workerIndex ] }

User brief:
${ brief }

Concurrency guardrails:
- Work only inside .studio/design/artifacts/directions/worker-${ slot }-r1/.
- Do not edit WordPress, the project manifest, another worker's directory, or an existing artifact.
- Give the direction a concise standalone name; do not include a number, worker, option, or version label.
- Build one self-contained responsive index.html and call design_artifact_finalize exactly once without parentArtifactId.
- The finalization tool owns the locked manifest update. Do not write project.json yourself.
- Make reasonable assumptions without asking the user questions.`;
}

function getCoordinatorPrompt( brief: string ): string {
	return `Load site-creator with the Skill tool. Studio has launched three archived design-worker sessions in parallel for this existing project.

User brief:
${ brief }

Act only as the visible coordinator:
1. Do not create, edit, or finalize a design while the workers are running.
2. Call design_project_wait with minimumArtifacts 3 and timeoutSeconds 600.
3. When it returns, call design_project_status and confirm the three directions have distinct names and approaches.
4. If three directions exist, give the user a short message that they are ready to compare. Do not build WordPress yet.
5. Only if the wait times out with fewer than three artifacts, create the missing direction(s) yourself in unique orchestrator-recovery directories, following the site-creator workflow.`;
}

export async function startConcurrentDesignGeneration( {
	connector,
	siteId,
	brief,
	model,
	attachments,
}: StartConcurrentDesignGenerationOptions ): Promise< StartedDesignGeneration > {
	const sessions: AiSessionSummary[] = [];
	const startedRunIds: string[] = [];

	try {
		const coordinator = await connector.createSession( siteId );
		sessions.push( coordinator );
		await connector.setSessionModel( coordinator.id, model );
		await connector.initializeDesignProject( siteId, brief, coordinator.id );

		// Session creation reuses empty drafts. Temporarily archive every session
		// before asking for the next one so each worker receives a distinct JSONL.
		await connector.updateSessionMetadata( coordinator.id, { archived: true } );
		for ( let workerIndex = 0; workerIndex < DIRECTION_ASSIGNMENTS.length; workerIndex += 1 ) {
			const worker = await connector.createSession( siteId );
			sessions.push( worker );
			await connector.setSessionModel( worker.id, model );
			await connector.updateSessionMetadata( worker.id, { archived: true } );
		}
		await connector.updateSessionMetadata( coordinator.id, { archived: false } );

		const runStarts = await Promise.allSettled( [
			...sessions
				.slice( 1 )
				.map( ( worker, workerIndex ) =>
					connector.continueSession( worker.id, getWorkerPrompt( brief, workerIndex ), attachments )
				),
			connector.continueSession( coordinator.id, getCoordinatorPrompt( brief ), {
				displayMessage: brief,
			} ),
		] );

		for ( const result of runStarts ) {
			if ( result.status === 'fulfilled' ) startedRunIds.push( result.value.runId );
		}
		const failedStart = runStarts.find(
			( result ): result is PromiseRejectedResult => result.status === 'rejected'
		);
		if ( failedStart ) throw failedStart.reason;

		return {
			session: coordinator,
			sessionIds: sessions.map( ( session ) => session.id ),
			runIds: startedRunIds,
		};
	} catch ( error ) {
		await Promise.allSettled(
			startedRunIds.map( ( runId ) => connector.interruptAgentRun( runId ) )
		);
		await Promise.allSettled(
			sessions.map( ( session ) => connector.deleteSession( session.id ) )
		);
		throw error;
	}
}

export const designGenerationPromptsForTesting = {
	getWorkerPrompt,
	getCoordinatorPrompt,
};
