import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { SiteOverviewView } from './index';
import type { ReactNode } from 'react';

vi.mock( '@tanstack/react-router', () => ( {
	Link: ( {
		to,
		params,
		className,
		children,
	}: {
		to: string;
		params?: { sessionId?: string };
		className?: string;
		children: ReactNode;
	} ) => {
		const href = params?.sessionId ? to.replace( '$sessionId', params.sessionId ) : to;
		return (
			<a href={ href } className={ className }>
				{ children }
			</a>
		);
	},
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useArchiveSession: vi.fn(),
	useSessions: vi.fn(),
	useUnarchiveSession: vi.fn(),
	useUpdateSessionTitleDescription: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useSitesMock = vi.mocked( useSites );
const useSessionsMock = vi.mocked( useSessions );
const useArchiveSessionMock = vi.mocked( useArchiveSession );
const useUnarchiveSessionMock = vi.mocked( useUnarchiveSession );
const useUpdateSessionTitleDescriptionMock = vi.mocked( useUpdateSessionTitleDescription );

describe( 'SiteOverviewView', () => {
	const archiveMutate = vi.fn();
	const unarchiveMutate = vi.fn();
	const updateTitleDescriptionMutateAsync = vi.fn();

	beforeEach( () => {
		archiveMutate.mockReset();
		unarchiveMutate.mockReset();
		updateTitleDescriptionMutateAsync.mockReset().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( { openExternalUrl: vi.fn() } as never );
		useArchiveSessionMock.mockReturnValue( { mutate: archiveMutate, isPending: false } as never );
		useUnarchiveSessionMock.mockReturnValue( {
			mutate: unarchiveMutate,
			isPending: false,
		} as never );
		useUpdateSessionTitleDescriptionMock.mockReturnValue( {
			mutateAsync: updateTitleDescriptionMutateAsync,
			isPending: false,
		} as never );
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					name: 'Example Site',
					path: '/Users/example/Studio/example-site',
					running: true,
					phpVersion: '8.3',
				},
			],
			isLoading: false,
		} as never );
		useSessionsMock.mockReturnValue( {
			data: [
				{
					id: 'active-session',
					firstPrompt: 'Active chat',
					ownerSitePath: '/Users/example/Studio/example-site',
					updatedAt: '2026-05-01T12:00:00.000Z',
				},
				{
					id: 'archived-session',
					firstPrompt: 'Archived chat',
					ownerSitePath: '/Users/example/Studio/example-site',
					updatedAt: '2026-05-02T12:00:00.000Z',
					archived: true,
				},
				{
					id: 'other-session',
					firstPrompt: 'Other site chat',
					ownerSitePath: '/Users/example/Studio/other-site',
					updatedAt: '2026-05-03T12:00:00.000Z',
				},
			],
			isLoading: false,
		} as never );
	} );

	it( 'lists active and archived chats for the selected site', () => {
		render( <SiteOverviewView siteId="site-1" /> );

		expect( screen.getByRole( 'heading', { name: 'Active' } ) ).toBeVisible();
		expect( screen.getByRole( 'link', { name: /Active chat/ } ) ).toHaveAttribute(
			'href',
			'/sessions/active-session'
		);
		expect( screen.getByRole( 'heading', { name: 'Archived' } ) ).toBeVisible();
		expect( screen.getByRole( 'link', { name: /Archived chat/ } ) ).toHaveAttribute(
			'href',
			'/sessions/archived-session'
		);
		expect( screen.queryByText( 'Other site chat' ) ).not.toBeInTheDocument();
	} );

	it( 'archives and unarchives chats from the site details view', () => {
		render( <SiteOverviewView siteId="site-1" /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Archive' } ) );
		expect( archiveMutate ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 'active-session' } )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Unarchive' } ) );
		expect( unarchiveMutate ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 'archived-session' } )
		);
	} );

	it( 'edits chat title and description from the site details view', async () => {
		render( <SiteOverviewView siteId="site-1" /> );

		fireEvent.click( screen.getAllByRole( 'button', { name: 'Edit' } )[ 0 ] );
		fireEvent.change( screen.getByLabelText( 'Title' ), {
			target: { value: 'Better title' },
		} );
		fireEvent.change( screen.getByLabelText( 'Description' ), {
			target: { value: 'Short useful description' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( updateTitleDescriptionMutateAsync ).toHaveBeenCalledWith( {
			sessionId: 'active-session',
			title: 'Better title',
			description: 'Short useful description',
		} );
	} );

	it( 'keeps unchanged generated chat details as generated metadata', async () => {
		useSessionsMock.mockReturnValue( {
			data: [
				{
					id: 'generated-session',
					firstPrompt: 'Original prompt',
					generatedTitle: 'Generated title',
					generatedDescription: 'Generated description',
					ownerSitePath: '/Users/example/Studio/example-site',
					updatedAt: '2026-05-01T12:00:00.000Z',
				},
			],
			isLoading: false,
		} as never );

		render( <SiteOverviewView siteId="site-1" /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Edit' } ) );
		expect( screen.getByLabelText( 'Title' ) ).toHaveValue( 'Generated title' );
		expect( screen.getByLabelText( 'Description' ) ).toHaveValue( 'Generated description' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( updateTitleDescriptionMutateAsync ).toHaveBeenCalledWith( {
			sessionId: 'generated-session',
			title: undefined,
			description: undefined,
		} );
	} );
} );
