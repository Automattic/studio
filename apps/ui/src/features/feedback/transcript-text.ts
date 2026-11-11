import type { TranscriptItem } from '@/features/chats';

const MAX_TEXT_LENGTH = 2000;
// The whole transcript, so a long chat stays a readable report.
const MAX_TRANSCRIPT_LENGTH = 12000;

function clip( text: string ): string {
	const trimmed = text.trim();
	return trimmed.length > MAX_TEXT_LENGTH ? `${ trimmed.slice( 0, MAX_TEXT_LENGTH ) }…` : trimmed;
}

// A plain-text rendering of a chat for a feedback report: what the user and
// the agent said, which tools ran, and which of them failed.
export function transcriptToText( items: TranscriptItem[] ): string {
	const lines: string[] = [];
	const add = ( item: TranscriptItem ) => {
		switch ( item.kind ) {
			case 'user-text':
				lines.push( `User: ${ clip( item.text ) }` );
				break;
			case 'assistant-text':
				if ( item.messageText.trim() ) lines.push( `Agent: ${ clip( item.messageText ) }` );
				break;
			case 'tool-use':
				lines.push(
					item.result?.isError
						? `Tool ${ item.name } failed: ${ clip( item.result.text ) }`
						: `Tool ${ item.name }`
				);
				break;
			case 'agent-question-batch':
				for ( const question of item.questions ) {
					lines.push(
						`Agent asked: ${ clip( question.question ) }${
							question.pickedLabel ? ` → ${ question.pickedLabel }` : ''
						}`
					);
				}
				break;
			case 'error-marker':
				lines.push( `Error: ${ clip( item.message ) }` );
				break;
			case 'activity':
				item.items.forEach( add );
				break;
			case 'chat-artifact':
				break;
		}
	};
	items.forEach( add );
	let dropped = 0;
	while ( lines.length > 1 && lines.join( '\n' ).length > MAX_TRANSCRIPT_LENGTH ) {
		lines.shift();
		dropped++;
	}
	if ( dropped ) lines.unshift( `[${ dropped } earlier lines left out]` );
	return lines.join( '\n' );
}
