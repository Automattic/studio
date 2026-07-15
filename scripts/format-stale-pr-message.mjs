#!/usr/bin/env node

/**
 * Format stale PR data into a Slack message payload
 *
 * This script reads PR data from /tmp/stale-prs.json and generates
 * a formatted Slack message at /tmp/slack-message.json
 */

import fs from 'fs';

// Read stale PRs data
const stalePRs = JSON.parse( fs.readFileSync( '/tmp/stale-prs.json', 'utf8' ) );

if ( stalePRs.length === 0 ) {
	console.log( 'No stale PRs to format' );
	process.exit( 0 );
}

// Calculate how long ago each PR was updated
function getTimeAgo( updatedAt ) {
	const now = Date.now();
	const updated = new Date( updatedAt ).getTime();
	const diffMs = now - updated;
	const diffHours = Math.floor( diffMs / ( 1000 * 60 * 60 ) );
	const diffDays = Math.floor( diffHours / 24 );

	if ( diffDays > 0 ) {
		return `${ diffDays } day${ diffDays > 1 ? 's' : '' } ago`;
	} else {
		return `${ diffHours } hour${ diffHours > 1 ? 's' : '' } ago`;
	}
}

// Format PR status
function getStatusEmoji( pr ) {
	if ( pr.reviewDecision === 'REVIEW_REQUIRED' ) {
		return '▶️';
	} else if ( pr.reviewDecision === 'CHANGES_REQUESTED' ) {
		return '⏩️️';
	} else {
		return '⏸️';
	}
}

// Build Slack message attachments
const attachments = stalePRs.map( ( pr ) => {
	const timeAgo = getTimeAgo( pr.updatedAt );
	const status = getStatusEmoji( pr );
	const author = pr.author.login;

	return {
		color: pr.reviewDecision === 'CHANGES_REQUESTED' ? 'warning' : 'good',
		fallback: `${ pr.title } by @${ author }`,
		title: `${ status } #${ pr.number }: ${ pr.title }`,
		title_link: pr.url,
		text: `@${ author } • ${ timeAgo }`,
		mrkdwn_in: [ 'text' ],
	};
} );

// Determine the time period based on day of week
const dayOfWeek = new Date().getDay();
const stalePeriod = dayOfWeek === 1 ? '72 hours' : '24 hours';

// Build complete Slack payload
const slackPayload = {
	username: 'PR Review Bot',
	icon_emoji: ':github:',
	text: `:sad-panda: *Stale Pull Requests Needing Review*\n\nHey <!subteam^S04HJ6B0JRF|@yolo-team>! I found ${
		stalePRs.length
	} PR${
		stalePRs.length > 1 ? 's' : ''
	} that haven't been updated in the last ${ stalePeriod } and still need review:`,
	attachments: [
		...attachments,
		{
			color: '#E8E8E8',
			text: 'To skip a PR from this notification, convert it to draft or approve it with a review. <https://github.com/Automattic/studio/blob/trunk/.github/workflows/stale-pr-notifications.yml|Edit this workflow>',
			mrkdwn_in: [ 'text' ],
		},
	],
};

// Write to file for the workflow to use
fs.writeFileSync( '/tmp/slack-message.json', JSON.stringify( slackPayload, null, 2 ) );

console.log( `✅ Formatted message for ${ stalePRs.length } stale PR(s)` );
