import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueuedPrompts } from './index';
import type { QueuedPrompt } from '@/data/queries/use-agent-run';

const queuedPrompt: QueuedPrompt = {
	id: 'queued-1',
	prompt: 'Tighten the hero spacing.',
};

describe( 'QueuedPrompts', () => {
	it( 'opens a queued prompt for editing on double click', () => {
		const onEdit = vi.fn();

		render( <QueuedPrompts prompts={ [ queuedPrompt ] } onRemove={ vi.fn() } onEdit={ onEdit } /> );

		fireEvent.doubleClick( screen.getByRole( 'button', { name: 'Edit queued follow-up' } ) );

		expect( onEdit ).toHaveBeenCalledWith( queuedPrompt );
	} );

	it( 'opens a queued prompt for editing with Enter', () => {
		const onEdit = vi.fn();

		render( <QueuedPrompts prompts={ [ queuedPrompt ] } onRemove={ vi.fn() } onEdit={ onEdit } /> );

		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Edit queued follow-up' } ), {
			key: 'Enter',
		} );

		expect( onEdit ).toHaveBeenCalledWith( queuedPrompt );
	} );

	it( 'opens a queued prompt for editing with Space', () => {
		const onEdit = vi.fn();

		render( <QueuedPrompts prompts={ [ queuedPrompt ] } onRemove={ vi.fn() } onEdit={ onEdit } /> );

		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Edit queued follow-up' } ), {
			key: ' ',
		} );

		expect( onEdit ).toHaveBeenCalledWith( queuedPrompt );
	} );

	it( 'discards without opening the queued prompt for editing', () => {
		const onEdit = vi.fn();
		const onRemove = vi.fn();

		render(
			<QueuedPrompts prompts={ [ queuedPrompt ] } onRemove={ onRemove } onEdit={ onEdit } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Discard queued follow-up' } ) );

		expect( onRemove ).toHaveBeenCalledWith( queuedPrompt.id );
		expect( onEdit ).not.toHaveBeenCalled();
	} );
} );
