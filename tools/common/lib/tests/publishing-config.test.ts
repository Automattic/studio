import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addDevelopmentProject,
	listDevelopmentProjects,
	removeDevelopmentProject,
	updateDevelopmentProjectLinkedSite,
} from '@studio/common/lib/publishing-config';
import { getPublishingConfigPath } from '@studio/common/lib/well-known-paths';

let configDir: string;
let pluginDir: string;

async function writePlugin( version = '1.0.0' ) {
	await fs.mkdir( pluginDir, { recursive: true } );
	await fs.writeFile(
		path.join( pluginDir, 'pressship-example.php' ),
		`<?php
/**
 * Plugin Name: Pressship Example
 * Version: ${ version }
 * Text Domain: pressship-example
 */`
	);
}

describe( 'publishing config', () => {
	beforeEach( async () => {
		configDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-publishing-config-' ) );
		pluginDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-plugin-project-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
		await writePlugin();
	} );

	afterEach( async () => {
		vi.unstubAllEnvs();
		await fs.rm( configDir, { force: true, recursive: true } );
		await fs.rm( pluginDir, { force: true, recursive: true } );
	} );

	it( 'adds and lists development projects', async () => {
		const project = await addDevelopmentProject( pluginDir );
		const projects = await listDevelopmentProjects();

		expect( project.name ).toBe( 'Pressship Example' );
		expect( projects ).toHaveLength( 1 );
		expect( projects[ 0 ] ).toMatchObject( {
			id: project.id,
			name: 'Pressship Example',
			slug: 'pressship-example',
			exists: true,
		} );
		await expect( fs.stat( getPublishingConfigPath() ) ).resolves.toBeDefined();
	} );

	it( 'updates an existing project instead of duplicating it', async () => {
		const firstProject = await addDevelopmentProject( pluginDir );
		await writePlugin( '2.0.0' );
		const secondProject = await addDevelopmentProject( pluginDir );
		const projects = await listDevelopmentProjects();

		expect( secondProject.id ).toBe( firstProject.id );
		expect( secondProject.info?.version ).toBe( '2.0.0' );
		expect( projects ).toHaveLength( 1 );
	} );

	it( 'removes development projects from the registry only', async () => {
		const project = await addDevelopmentProject( pluginDir );
		const projects = await removeDevelopmentProject( project.id );

		expect( projects ).toHaveLength( 0 );
		await expect( fs.stat( pluginDir ) ).resolves.toBeDefined();
	} );

	it( 'stores a linked Playground site id for a development project', async () => {
		const project = await addDevelopmentProject( pluginDir );
		const updatedProject = await updateDevelopmentProjectLinkedSite(
			project.id,
			'playground-site-id'
		);
		const projects = await listDevelopmentProjects();

		expect( updatedProject.linkedSiteId ).toBe( 'playground-site-id' );
		expect( projects[ 0 ].linkedSiteId ).toBe( 'playground-site-id' );
	} );
} );
