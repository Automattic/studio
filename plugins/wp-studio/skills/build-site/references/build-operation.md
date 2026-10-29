# Build operation prototype

Resolve `ADAPTER` to `../../scripts/build-operation.mjs` relative to this
skill directory. It requires the source checkout's dependencies and currently
targets macOS/Linux. Keep its run command attached to a tracked execution handle.

Write a request JSON file containing:

```json
{
  "name": "Example",
  "slug": "example-unique",
  "prompt": "The full user brief, including required features.",
  "harness": "codex",
  "images": "harness",
  "singlePage": false,
  "designFallback": false,
  "publish": {
    "remoteSite": "https://explicitly-requested-destination.example",
    "visibility": "preserve"
  }
}
```

`harness` names this session: codex, claude, or grok. Use `images: "harness"`
only when this session or Studio can generate images; `"none"` requires a brief
that permits no generated images. The engine location resolves from request
`engineHome`, then `SITE_BUILD_HOME`, then `../site-builder-engine` relative to
the Studio checkout. The default does not depend on the caller's working
directory. Optional `studioCommand` is a command argv array; `STUDIO_CLI_BIN`
also selects a built development CLI. The engine and checks use the same CLI.
`engineArguments` forwards graph/feature/upload flags as `--flag=value`
entries. Omit it for DSL Fast with the full default feature set. Bounded builds,
identity overrides, and existing-content workflows are rejected.
Enable `designFallback` only for the optional Studio catalog experiment;
the adapter rejects it if this engine checkout lacks that capability.
Omit `publish` for a local-only build. With a destination, the same run resolves
it before generation, imports and checks locally, then publishes and verifies.
Use `visibility: "private"` only for an explicit private-publication request.
If private access cannot be confirmed, no transfer occurs.

Use a fresh absolute operation directory under
`~/Studio/.build-operations/<name>`, which also lets Studio's image fallback
write there. The directory stores the operation ID, status, request, logs,
screenshots, and timings.

```sh
node "$ADAPTER" run "$OPERATION_DIRECTORY" "$REQUEST_JSON"
node "$ADAPTER" status "$OPERATION_DIRECTORY"
```

The foreground run emits JSON when phase, progress, URLs, warnings, or image
requests change. Status returns pending requests and whether they are claimed.
Claim each commission once, generate its exact prompt/options, then deliver:

```sh
node "$ADAPTER" image-claim "$OPERATION_DIRECTORY" "$REQUEST_ID"
node "$ADAPTER" image-complete "$OPERATION_DIRECTORY" "$REQUEST_ID" "$PNG"
# For an actual generation failure:
node "$ADAPTER" image-fail "$OPERATION_DIRECTORY" "$REQUEST_ID" "Failure reason"
```

Do not regenerate claimed requests or create a second Studio site. The engine
owns image budgets and finalization.

A `ready` result means generation, import and automated rendering checks passed.
Inspect the returned screenshots for visual quality; load visual-polish only
for this review or a concrete failure. Email delivery and payment setup are not
implied. Stop collecting evidence once the requested checks pass.

Publish only to an explicitly requested destination:

```sh
node "$ADAPTER" publish "$OPERATION_DIRECTORY" "https://exact-destination.example"
```

The adapter calls the CLI's `publish` workflow, which delegates transfer to the
existing push command. It owns destination lookup, visibility preflight,
temporary export settings and restoration, progress, page content hashes,
media verification, and anonymous access checks. `published` means these checks
passed; transfer completion alone does not count as success.

If a transfer is uncertain, verify it without uploading again:

```sh
node "$ADAPTER" verify-publication "$OPERATION_DIRECTORY"
```

Only an explicit request to publish again permits a new transfer after a
verified result. Use `republish` with the same arguments as `publish`; it creates
a separate receipt. Do not turn a failed or uncertain transfer into a new one.

Failures preserve projects and logs. Inspect status before acting. Reusing an
operation directory is refused. Automatic resumption of partial engine runs
is outside this prototype; use the engine's
documented recovery workflow instead of starting another paid build.
