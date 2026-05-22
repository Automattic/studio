import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './index';
import type { ReactNode } from 'react';

const composerMocks = vi.hoisted( () => ( {
	onSend: vi.fn(),
	onInterrupt: vi.fn(),
	onLogin: vi.fn(),
	setQueryData: vi.fn(),
	invalidateQueries: vi.fn(),
	setSessionModel: vi.fn(),
	createSession: vi.fn(),
	consumeComposerWidgetAttachmentRequest: vi.fn(),
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text: string ) => text,
	sprintf: ( text: string, ...values: string[] ) =>
		values.reduce(
			( result, value, index ) =>
				result.replace( `%${ index + 1 }$s`, value ).replace( '%s', value ),
			text
		),
} ) );

vi.mock( '@wordpress/icons', () => ( {
	arrowUp: {},
	chevronDownSmall: {},
	closeSmall: {},
	code: {},
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Icon: () => null,
} ) );

vi.mock( '@tanstack/react-query', () => ( {
	useQueryClient: () => ( {
		setQueryData: composerMocks.setQueryData,
		invalidateQueries: composerMocks.invalidateQueries,
	} ),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		setSessionModel: composerMocks.setSessionModel,
		createSession: composerMocks.createSession,
	} ),
} ) );

vi.mock( '@/ui-desks/chats/context', () => ( {
	useChats: () => ( {
		composerWidgetAttachmentRequest: undefined,
		consumeComposerWidgetAttachmentRequest: composerMocks.consumeComposerWidgetAttachmentRequest,
		isComposerWidgetDragTarget: false,
	} ),
} ) );

vi.mock( '@/ui-desks/chats/widget-context', () => ( {
	buildWidgetContextDisplayMessage: ( prompt: string ) => prompt,
	buildWidgetContextPrompt: ( prompt: string ) => prompt,
	getWidgetDisplayLabel: () => 'Widget',
	MAX_VISIBLE_CHAT_WIDGETS: 3,
	WidgetContextMoreThumbnail: () => null,
	WidgetContextThumbnail: () => null,
} ) );

vi.mock( '@/ui-desks/components', async () => {
	const React = await vi.importActual< typeof import('react') >( 'react' );
	const passthrough = ( { children }: { children?: ReactNode } ) =>
		React.createElement( React.Fragment, null, children );

	return {
		Button: ( {
			children,
			disabled,
			label,
			onClick,
			type = 'button',
			...props
		}: {
			children?: ReactNode;
			disabled?: boolean;
			label: string;
			onClick?: () => void;
			type?: 'button' | 'submit';
		} ) =>
			React.createElement(
				'button',
				{
					...props,
					'aria-label': label,
					disabled,
					onClick,
					type,
				},
				children ?? label
			),
		Menu: {
			Root: passthrough,
			Trigger: ( { render }: { render: ReactNode } ) => render,
			Popup: passthrough,
			Item: ( { children, onClick }: { children?: ReactNode; onClick?: () => void } ) =>
				React.createElement( 'button', { type: 'button', onClick }, children ),
			RadioGroup: passthrough,
			RadioItem: ( { children }: { children?: ReactNode } ) =>
				React.createElement( 'div', null, children ),
		},
	};
} );

describe( 'desks chat Composer', () => {
	beforeEach( () => {
		composerMocks.onSend.mockReset().mockResolvedValue( undefined );
		composerMocks.onInterrupt.mockReset().mockResolvedValue( undefined );
		composerMocks.onLogin.mockReset();
		composerMocks.setQueryData.mockReset();
		composerMocks.invalidateQueries.mockReset();
		composerMocks.setSessionModel.mockReset().mockResolvedValue( undefined );
		composerMocks.createSession.mockReset().mockResolvedValue( { id: 'new-session' } );
		composerMocks.consumeComposerWidgetAttachmentRequest.mockReset();
	} );

	it( 'keeps the idle send button visible even when the prompt is empty', () => {
		renderComposer( { busy: false } );

		expect( screen.getByRole( 'button', { name: 'Send' } ) ).toBeDisabled();
	} );

	it( 'hides the queue button while busy until the user types a prompt', () => {
		renderComposer( { busy: true } );

		expect( screen.getByRole( 'button', { name: 'Stop' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Queue' } ) ).not.toBeInTheDocument();

		fireEvent.change( screen.getByPlaceholderText( 'Ask Studio Desk…' ), {
			target: { value: 'Follow up on this' },
		} );

		expect( screen.getByRole( 'button', { name: 'Queue' } ) ).toBeEnabled();
	} );

	it( 'shows a login requirement and blocks the composer when unauthenticated', () => {
		renderComposer( { busy: false, authRequired: true } );

		expect(
			screen.getByText( 'Log in with WordPress.com to use Studio Desk chat.' )
		).toBeVisible();
		expect( screen.getByPlaceholderText( 'Log in to use Studio Desk chat.' ) ).toBeDisabled();

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );

		expect( composerMocks.onLogin ).toHaveBeenCalledTimes( 1 );
		expect( composerMocks.onSend ).not.toHaveBeenCalled();
	} );
} );

function renderComposer( {
	busy,
	authRequired = false,
}: {
	busy: boolean;
	authRequired?: boolean;
} ) {
	return render(
		<Composer
			busy={ busy }
			error={ null }
			authRequired={ authRequired }
			onLogin={ composerMocks.onLogin }
			model="claude-sonnet-4-6"
			onSend={ composerMocks.onSend }
			onInterrupt={ composerMocks.onInterrupt }
		/>
	);
}
