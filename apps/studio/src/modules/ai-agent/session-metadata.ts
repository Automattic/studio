import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { loadAiSession } from '@studio/common/ai/sessions/store';
import {
	readSharedSession,
	updateSharedSession,
	type SharedSessionMetadata,
} from '@studio/common/lib/shared-config';
import { __, sprintf } from '@wordpress/i18n';
import { getAiSessionsRootDirectory } from 'src/lib/ai-sessions';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';

const TITLE_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 220;
const SUMMARY_MIN_USER_PROMPTS = 3;
const SUMMARY_REGENERATE_EVENT_DELTA = 8;

function stripTrailingSentencePunctuation( value: string ): string {
	return value.replace( /[.!?]+$/, '' ).trim();
}

function cleanText( value: string | undefined ): string {
	return ( value ?? '' )
		.replace( /```[\s\S]*?```/g, ' ' )
		.replace( /`([^`]+)`/g, '$1' )
		.replace( /\[([^\]]+)\]\([^)]+\)/g, '$1' )
		.replace( /https?:\/\/\S+/g, ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
}

function truncateAtWordBoundary( value: string, maxLength: number ): string {
	if ( value.length <= maxLength ) {
		return value;
	}
	// Reserve room for the ellipsis so the result never exceeds maxLength.
	const budget = maxLength - 3;
	const truncated = value.slice( 0, budget + 1 );
	const lastSpace = truncated.lastIndexOf( ' ' );
	const candidate =
		lastSpace > budget * 0.6 ? truncated.slice( 0, lastSpace ) : truncated.slice( 0, budget );
	return `${ candidate.trim().replace( /[.,;:!?-]+$/, '' ) }...`;
}

function stripPromptPrefix( value: string ): string {
	return value
		.replace( /^(please|can you|could you|would you|help me|i need you to|i want to)\s+/i, '' )
		.replace( /^(build|create|make|add|fix|update|change|review|explain)\s+me\s+/i, '$1 ' )
		.trim();
}

function getUserPrompts( entries: SessionEntry[] ): string[] {
	const prompts: string[] = [];
	for ( const entry of entries ) {
		if ( ! isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			continue;
		}
		if ( entry.data?.source !== 'prompt' ) {
			continue;
		}
		const text = cleanText( entry.data.text );
		if ( text ) {
			prompts.push( text );
		}
	}
	return prompts;
}

function buildGeneratedTitle( summary: AiSessionSummary ): string | undefined {
	const firstPrompt = stripPromptPrefix( cleanText( summary.firstPrompt ) );
	if ( ! firstPrompt ) {
		return undefined;
	}

	const firstLine = firstPrompt.split( /(?<=[.!?])\s+|\n/ )[ 0 ] ?? firstPrompt;
	// Strip sentence punctuation before truncating; the other way around
	// would eat the ellipsis the truncation just appended.
	return truncateAtWordBoundary( stripTrailingSentencePunctuation( firstLine ), TITLE_MAX_LENGTH );
}

function buildGeneratedDescription(
	summary: AiSessionSummary,
	userPrompts: string[]
): string | undefined {
	const title = cleanText( summary.title ) || buildGeneratedTitle( summary );
	const assistantPreview = cleanText( summary.assistantReplyPreview );

	if ( title && assistantPreview ) {
		return truncateAtWordBoundary(
			sprintf(
				/* translators: 1: chat title, 2: preview of the assistant's latest reply */
				__( 'Working on %1$s. Latest: %2$s' ),
				title,
				assistantPreview
			),
			DESCRIPTION_MAX_LENGTH
		);
	}

	const promptSummary = userPrompts.slice( 0, 3 ).join( '; ' );
	return promptSummary
		? truncateAtWordBoundary( promptSummary, DESCRIPTION_MAX_LENGTH )
		: undefined;
}

function shouldGenerateDescription(
	summary: AiSessionSummary,
	metadata: SharedSessionMetadata,
	userPromptCount: number
): boolean {
	if ( metadata.userDescription ) {
		return false;
	}
	if ( userPromptCount < SUMMARY_MIN_USER_PROMPTS ) {
		return false;
	}
	if ( metadata.descriptionGeneratedEventCount === undefined ) {
		return true;
	}
	return (
		summary.eventCount - metadata.descriptionGeneratedEventCount >= SUMMARY_REGENERATE_EVENT_DELTA
	);
}

export async function generateAiSessionMetadata( sessionId: string ): Promise< void > {
	const { summary, entries } = await loadAiSession( getAiSessionsRootDirectory(), sessionId );
	const metadata = ( await readSharedSession( summary.id ) ) ?? {};
	const now = new Date().toISOString();
	const patch: Partial< SharedSessionMetadata > = {};
	const userPrompts = getUserPrompts( entries );

	if ( ! metadata.userTitle && ! metadata.generatedTitle ) {
		const generatedTitle = buildGeneratedTitle( summary );
		if ( generatedTitle ) {
			patch.generatedTitle = generatedTitle;
			patch.titleGeneratedAt = now;
		}
	}

	if ( shouldGenerateDescription( summary, metadata, userPrompts.length ) ) {
		const generatedDescription = buildGeneratedDescription(
			{
				...summary,
				title:
					metadata.userTitle ??
					metadata.generatedTitle ??
					patch.generatedTitle ??
					summary.firstPrompt,
			},
			userPrompts
		);
		if ( generatedDescription ) {
			patch.generatedDescription = generatedDescription;
			patch.descriptionGeneratedAt = now;
			patch.descriptionGeneratedEventCount = summary.eventCount;
		}
	}

	if ( Object.keys( patch ).length > 0 ) {
		await updateSharedSession( summary.id, patch );
	}
}
