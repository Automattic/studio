<?php

declare(strict_types=1);

function usage(): never
{
    fwrite(STDERR, "Usage: php scripts/generate-figma-fixture.php --blocks-engine-path=/path/to/blocks-engine/figma-transformer --output=/path/to/fixture.fig\n");
    exit(2);
}

$options = getopt('', array('blocks-engine-path:', 'output:'));
if (! isset($options['blocks-engine-path'], $options['output'])) {
    usage();
}

$blocksEnginePath = rtrim((string) $options['blocks-engine-path'], DIRECTORY_SEPARATOR);
$output = (string) $options['output'];
$fixtureBuilder = $blocksEnginePath . '/tests/contract/SyntheticFigKiwiFixtureBuilder.php';
if (! is_file($fixtureBuilder)) {
    throw new RuntimeException("Blocks Engine test helper not found: {$fixtureBuilder}");
}
if (! class_exists('ZipArchive')) {
    throw new RuntimeException('The PHP zip extension is required.');
}
if (! function_exists('zstd_compress')) {
    throw new RuntimeException('The PHP zstd extension is required to generate the zstd chunk.');
}

require_once $fixtureBuilder;

$canvas = SyntheticFigKiwiFixtureBuilder::canvas(array(
    SyntheticFigKiwiFixtureBuilder::jsonZlibChunk(
        SyntheticFigKiwiFixtureBuilder::nodeChangesPayload('Studio Fixture')
    ),
    SyntheticFigKiwiFixtureBuilder::zstdMarkerChunk('Studio fixture zstd capability check'),
));
$generated = SyntheticFigKiwiFixtureBuilder::figArchive(
    $canvas,
    array(),
    array('name' => 'Studio Fixture')
);

if (! @rename($generated, $output)) {
    @unlink($generated);
    throw new RuntimeException("Could not write fixture: {$output}");
}

// Keep the helper-generated archive reproducible without reimplementing its .fig semantics.
$archive = new ZipArchive();
if (true !== $archive->open($output)) {
    throw new RuntimeException("Could not reopen fixture: {$output}");
}
foreach (array('canvas.fig', 'meta.json') as $entry) {
    if (! $archive->setMtimeName($entry, 0)) {
        throw new RuntimeException("Could not normalize fixture entry: {$entry}");
    }
}
$archive->close();

echo "Generated {$output}\n";
