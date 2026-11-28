import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceLine,
	TraceTitle,
} from '.';

it( 'opens and closes a trace with the keyboard and associates its content', async () => {
	const user = userEvent.setup();
	render(
		<Trace>
			<TraceCollapsible>
				<TraceCollapsibleTrigger>
					<TraceLine>
						<TraceTitle>Read theme.json</TraceTitle>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>Theme content</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
	await user.tab();
	const trigger = screen.getByRole( 'button', { name: 'Read theme.json' } );
	expect( trigger ).toHaveFocus();
	expect( trigger ).toHaveAttribute( 'aria-expanded', 'false' );
	await user.keyboard( '{Enter}' );
	expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );
	expect( document.getElementById( trigger.getAttribute( 'aria-controls' )! ) ).toHaveTextContent(
		'Theme content'
	);
	await user.keyboard( ' ' );
	expect( trigger ).toHaveAttribute( 'aria-expanded', 'false' );
	expect( trigger ).toHaveFocus();
} );
