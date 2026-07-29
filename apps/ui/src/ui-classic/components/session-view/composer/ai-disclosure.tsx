import { getAiModelShortLabel } from '@studio/common/ai/models';
import { __, sprintf } from '@wordpress/i18n';
import styles from './style.module.css';
import type { AiModelId } from '@/data/core';

/**
 * Persistent notice that the other side of the chat is an AI. Required at or
 * before the first interaction by EU AI Act Art. 50(1), and shown to everyone
 * rather than geo-gated. Doubles as the model picker's label — naming the model
 * is what lets one line serve both jobs. Referenced by the prompt field's
 * `aria-describedby` so it is announced on focus rather than relying on visual
 * proximity alone.
 */
export function AiDisclosure( { id, model }: { id: string; model: AiModelId } ) {
	return (
		<span className={ styles.aiDisclosure } id={ id }>
			{ sprintf(
				/* translators: %s: name of the selected AI model, e.g. "Sonnet". */
				__( 'Chatting with %s AI' ),
				getAiModelShortLabel( model )
			) }
		</span>
	);
}
