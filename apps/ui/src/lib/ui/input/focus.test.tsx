import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Textarea } from '@/lib/ui/textarea';
import { Input } from '.';

it.each( [ Input, Textarea ] )(
	'distinguishes pointer focus from Tab focus and preserves handlers',
	async ( Control ) => {
		const user = userEvent.setup();
		const onPointerDown = vi.fn();
		const onBlur = vi.fn();
		const onKeyDown = vi.fn();
		render(
			<>
				<button>Before</button>
				<Control aria-label="Message" { ...{ onPointerDown, onBlur, onKeyDown } } />
				<button>After</button>
			</>
		);
		const input = screen.getByRole( 'textbox', { name: 'Message' } );
		await user.click( input );
		await user.keyboard( 'Hello' );
		expect( input ).toHaveAttribute( 'data-pointer-focus' );
		expect( onPointerDown ).toHaveBeenCalledOnce();
		expect( onKeyDown ).toHaveBeenCalled();
		await user.tab();
		expect( screen.getByRole( 'button', { name: 'After' } ) ).toHaveFocus();
		expect( onBlur ).toHaveBeenCalledOnce();
		await user.tab( { shift: true } );
		expect( input ).toHaveFocus();
		expect( input ).not.toHaveAttribute( 'data-pointer-focus' );
	}
);
