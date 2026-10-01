# How the CLI and Studio apps communicate

## About this doc

This document describes how the Studio CLI and the apps built on it (the desktop app, the `studio ui` server and the Studio Code agent) exchange work and state. It covers the principles they follow; remaining work is tracked in [#4963](https://github.com/Automattic/studio/issues/4963).

## Context

The CLI runs every site operation: creating, starting and stopping sites, importing and exporting, pushing and pulling, and publishing previews. Several things can start those operations at the same time: a button in the desktop app or the browser UI, the agent, or a user typing a command in a terminal. Every app has to show the same site state whoever started the work, and operations must not trip over each other on the same site.

## Principles

1. **One implementation per operation, in the CLI.** Every surface runs the CLI command rather than rebuilding the operation from shared pieces. When an app needs something a command doesn't offer (structured progress, a non-interactive option, cancellation), the command is extended. Parallel implementations drift: each fix has to land twice, and only one of them ends up driving the UI.
2. **Operations publish what they do.** A command reports the state it changes (sites, preview sites, login) and the activity it performs (a sync or an import starting, progressing and finishing) as events. It doesn't matter who started it.
3. **The UI renders shared state, not responses to its own calls.** Busy states, progress, toasts and data refreshes come from the published events. A call made by the UI only starts the work and returns its result. The UI falls back on that result only when the command never got far enough to report anything itself.
4. **Operations hold the site while they touch it.** While a command is writing to a site's files or database, or reading them into an archive, it holds the site. Other operations on that site are refused with a clear reason instead of racing it. Waits on the network don't hold the site.
5. **Site changes go through the CLI.** Site configuration is only changed by CLI commands, which keeps locking and invariants in one place.

## How events reach the apps

Each running Studio app runs the hidden `_events` command, which listens on a socket of its own. A CLI process sends each event to every app's socket, skipping apps that aren't running. Each app relays the events to its UI, which refreshes the state that changed and updates the activity shown on the site. Two copies of the same app (for example two `studio ui` servers) would share one socket, so only the newest receives events.

`_events` also reports site processes starting and stopping, which it learns from the process manager that supervises them.

## Cancelling

An app cancels an operation it started by stopping the CLI process running it. The command then reports the cancellation and exits, unless it has passed the point where stopping is safe (for example once a push has started changing the live site). An operation started by the agent or a terminal can't be cancelled from an app, so the UI doesn't offer it.
