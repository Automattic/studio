import { AI_MODELS, type AiModelId } from '@studio/common/ai/models';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '.';

const model = Object.keys( AI_MODELS )[ 0 ] as AiModelId;

function renderComposer( props?: Partial< Parameters< typeof Composer >[ 0 ] > ) {
	const onInterrupt = vi.fn().mockResolvedValue( undefined );
	const onSend = vi.fn().mockResolvedValue( undefined );
	render(
		<Composer
			busy={ false }
			error={ null }
			model={ model }
			onModelChange={ vi.fn() }
			onSend={ onSend }
			onInterrupt={ onInterrupt }
			{ ...props }
		/>
	);
	return { onInterrupt, onSend };
}

describe( 'Composer', () => {
	it( 'interrupts with Escape while busy', () => {
		const { onInterrupt } = renderComposer( { busy: true } );

		fireEvent.keyDown( screen.getByRole( 'textbox' ), { key: 'Escape' } );

		expect( onInterrupt ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not interrupt with Escape while idle', () => {
		const { onInterrupt } = renderComposer( { busy: false } );

		fireEvent.keyDown( screen.getByRole( 'textbox' ), { key: 'Escape' } );

		expect( onInterrupt ).not.toHaveBeenCalled();
	} );
} );
