import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import {
	CliCommandError,
	runCliCommand,
	type ExecuteCliCommand,
} from '@studio/common/lib/cli-process';

const signInResultSchema = z.object( { signedIn: z.literal( true ) } );

// One sign-in at a time per host: starting another (the user closed the
// sign-in tab and clicked again) stops the CLI process still waiting for the
// browser, which also frees its callback port.
let activeSignIn: AbortController | undefined;

/**
 * Sign in with ChatGPT through `studio code chatgpt login`, which opens the
 * sign-in page in the browser and resolves once the user finishes there. The
 * sign-in runs in the CLI because pi, which implements it, ships only there.
 */
export async function signInWithChatGpt( execute: ExecuteCliCommand ): Promise< void > {
	activeSignIn?.abort();
	const controller = new AbortController();
	activeSignIn = controller;
	try {
		await runCliCommand( execute, [ 'code', 'chatgpt', 'login' ], signInResultSchema, {
			logPrefix: 'chatgpt',
			signal: controller.signal,
		} );
	} catch ( error ) {
		if ( controller.signal.aborted ) {
			throw new Error( __( 'ChatGPT sign-in was cancelled.' ) );
		}
		if ( error instanceof CliCommandError && error.lastErrorMessage ) {
			throw new Error( error.lastErrorMessage );
		}
		throw error;
	} finally {
		if ( activeSignIn === controller ) {
			activeSignIn = undefined;
		}
	}
}
