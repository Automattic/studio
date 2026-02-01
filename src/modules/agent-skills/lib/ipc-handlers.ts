/**
 * IPC handlers for the AgentSkills module.
 *
 * These handlers are exposed to the renderer process via preload.ts
 * and handle all skill-related operations.
 */

import { loadUserData } from 'src/storage/user-data';
import { DEFAULT_BRANCH, DEFAULT_SKILLS_REPO } from './constants';
import { discoverSiteSkills } from './skill-discovery';
import {
	installSkillFromGitHub,
	listAvailableSkills as listAvailableSkillsFromRepo,
	removeSkill as removeSkillFromDisk,
} from './skill-installer';
import { buildSkillsPromptXml } from './skill-prompt-builder';
import type { AvailableSkill, Skill, SkillInstallResult } from '../types';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * Get the site path for a given site ID.
 *
 * @param siteId - The site ID to look up
 * @returns The site's file path
 * @throws Error if site is not found
 */
async function getSitePath( siteId: string ): Promise< string > {
	const userData = await loadUserData();
	const site = userData.sites.find( ( s ) => s.id === siteId );

	if ( ! site ) {
		throw new Error( `Site not found: ${ siteId }` );
	}

	return site.path;
}

/**
 * Get all skills installed for a site.
 *
 * @param _event - IPC event
 * @param siteId - The site ID to get skills for
 * @returns Array of installed skills
 */
export async function getSiteSkills(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< Skill[] > {
	const sitePath = await getSitePath( siteId );
	return discoverSiteSkills( sitePath );
}

/**
 * Install a skill from a GitHub repository.
 *
 * @param _event - IPC event
 * @param siteId - The site ID to install the skill to
 * @param repo - Repository in "owner/repo" format
 * @param skillPath - Path to the skill within the repo
 * @param branch - Branch to install from (optional)
 * @returns Installation result
 */
export async function installSkill(
	_event: IpcMainInvokeEvent,
	siteId: string,
	repo: string,
	skillPath: string,
	branch?: string
): Promise< SkillInstallResult > {
	const sitePath = await getSitePath( siteId );
	return installSkillFromGitHub( sitePath, repo, skillPath, branch || DEFAULT_BRANCH );
}

/**
 * Remove an installed skill from a site.
 *
 * @param _event - IPC event
 * @param siteId - The site ID to remove the skill from
 * @param skillName - Name of the skill to remove
 */
export async function removeSkill(
	_event: IpcMainInvokeEvent,
	siteId: string,
	skillName: string
): Promise< void > {
	const sitePath = await getSitePath( siteId );
	return removeSkillFromDisk( sitePath, skillName );
}

/**
 * List available skills from a GitHub repository.
 *
 * @param _event - IPC event
 * @param repo - Repository in "owner/repo" format (optional, defaults to WordPress/agent-skills)
 * @param branch - Branch to list from (optional)
 * @returns Array of available skills
 */
export async function listAvailableSkills(
	_event: IpcMainInvokeEvent,
	repo?: string,
	branch?: string
): Promise< AvailableSkill[] > {
	return listAvailableSkillsFromRepo( repo || DEFAULT_SKILLS_REPO, branch || DEFAULT_BRANCH );
}

/**
 * Get the skills XML for injection into an AI agent's system prompt.
 *
 * @param _event - IPC event
 * @param siteId - The site ID to get skills for
 * @returns XML string for the system prompt, or empty string if no skills
 */
export async function getSkillsPromptXml(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< string > {
	const sitePath = await getSitePath( siteId );
	const skills = await discoverSiteSkills( sitePath );
	return buildSkillsPromptXml( skills );
}
