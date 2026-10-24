import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	useSetAllWordPressSkills,
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
	useWordPressSkills,
} from '@/data/queries/use-wordpress-skills';
import { SkillsPanel } from './skills-panel';

vi.mock( '@/features/settings/learn-more', () => ( {
	LearnMoreLink: () => <button type="button">Learn more</button>,
} ) );

vi.mock( '@/data/queries/use-wordpress-skills', () => ( {
	useSetAllWordPressSkills: vi.fn(),
	useInstallWordPressSkill: vi.fn(),
	useRemoveWordPressSkill: vi.fn(),
	useWordPressSkills: vi.fn(),
} ) );

const useSetAllWordPressSkillsMock = vi.mocked( useSetAllWordPressSkills );
const useInstallWordPressSkillMock = vi.mocked( useInstallWordPressSkill );
const useRemoveWordPressSkillMock = vi.mocked( useRemoveWordPressSkill );
const useWordPressSkillsMock = vi.mocked( useWordPressSkills );

describe( 'SkillsPanel', () => {
	const installSkillMutate = vi.fn();
	const setAllSkillsMutate = vi.fn();
	const removeSkillMutate = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		useWordPressSkillsMock.mockReturnValue( {
			data: [
				{
					id: 'studio-cli',
					displayName: 'Studio CLI',
					description: 'Manage sites from the command line.',
					installed: true,
				},
				{
					id: 'wp-rest-api',
					displayName: 'WP REST API',
					description: 'Query WordPress content over REST.',
					installed: false,
				},
			],
			isLoading: false,
			error: null,
		} as never );
		useInstallWordPressSkillMock.mockReturnValue( {
			mutate: installSkillMutate,
			isPending: false,
			error: null,
		} as never );
		useSetAllWordPressSkillsMock.mockReturnValue( {
			mutate: setAllSkillsMutate,
			isPending: false,
			error: null,
		} as never );
		useRemoveWordPressSkillMock.mockReturnValue( {
			mutate: removeSkillMutate,
			isPending: false,
			error: null,
		} as never );
	} );

	it( 'shows a toggle per skill reflecting its installed state', () => {
		render( <SkillsPanel /> );

		expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).toBeChecked();
		expect( screen.getByRole( 'switch', { name: 'WP REST API' } ) ).not.toBeChecked();
	} );

	it( 'installs on toggling an uninstalled skill and removes on toggling an installed one', () => {
		render( <SkillsPanel /> );

		fireEvent.click( screen.getByRole( 'switch', { name: 'WP REST API' } ) );
		fireEvent.click( screen.getByRole( 'switch', { name: 'Studio CLI' } ) );

		expect( installSkillMutate ).toHaveBeenCalledWith( 'wp-rest-api' );
		expect( removeSkillMutate ).toHaveBeenCalledWith( 'studio-cli' );
	} );

	it( 'turns every installed skill off from the WordPress skills switch', () => {
		render( <SkillsPanel /> );

		fireEvent.click( screen.getByRole( 'switch', { name: 'WordPress skills' } ) );

		expect( setAllSkillsMutate ).toHaveBeenCalledWith( {
			skillIds: [ 'studio-cli' ],
			installed: false,
		} );
	} );

	it( 'offers Retry when the skills fail to load', () => {
		const refetch = vi.fn();
		useWordPressSkillsMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
			isError: true,
			refetch,
		} as never );

		render( <SkillsPanel /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );

		expect( refetch ).toHaveBeenCalled();
	} );

	it( 'says when no skills are available', () => {
		useWordPressSkillsMock.mockReturnValue( { data: [], isLoading: false } as never );

		render( <SkillsPanel /> );

		expect( screen.getByText( 'No skills are available.' ) ).toBeInTheDocument();
	} );

	it( 'hides the skill list while skills are off', () => {
		useWordPressSkillsMock.mockReturnValue( {
			data: [ { id: 'studio-cli', displayName: 'Studio CLI', description: '', installed: false } ],
			isLoading: false,
		} as never );

		render( <SkillsPanel /> );

		expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).not.toBeChecked();
		expect( screen.queryByRole( 'switch', { name: 'Studio CLI' } ) ).not.toBeInTheDocument();
	} );

	it( 'disables every toggle while a change saves', () => {
		useInstallWordPressSkillMock.mockReturnValue( {
			mutate: installSkillMutate,
			isPending: true,
			error: null,
		} as never );

		render( <SkillsPanel onManageSite={ vi.fn() } /> );

		expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).toHaveAttribute(
			'data-disabled'
		);
		expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).toHaveAttribute(
			'data-disabled'
		);
		expect( screen.getByRole( 'button', { name: 'Manage skills for this site' } ) ).toBeDisabled();
	} );
} );
