# frozen_string_literal: true

# Pure-Ruby helpers for Studio release versions and tags.
#
# Studio release versions follow `X.Y.Z` for stable releases and `X.Y.Z-betaN` for prereleases.
# Methods suffixed with `!` (`next_patch_version!`, `npm_dist_tag_for!`) require canonical input
# and raise `ArgumentError` on anything else, as used by the npm release lane where typos should
# fail loudly. The remaining helpers (`prerelease?`, `base_version`, `beta_number`) are lenient
# and accept tag/branch-style inputs like `v1.7.4-beta1` or `release/1.7.4-beta1` too.
#
# Extracted from the Fastfile so they can be unit-tested without booting fastlane.
# See fastlane/test/studio_release_version_test.rb.
module StudioReleaseVersion
  VERSION_PATTERN = /\A\d+\.\d+\.\d+(-beta\d+)?\z/.freeze
  BETA_SUFFIX = /-beta(\d+)\z/.freeze

  module_function

  # Whether the given version string matches the canonical Studio release format
  # (`X.Y.Z` or `X.Y.Z-betaN`).
  def valid_version?(version)
    return false if version.nil?

    !!version.match?(VERSION_PATTERN)
  end

  # Strip any `-betaN` suffix and bump the patch component by one. Raises `ArgumentError` when
  # the input is not a canonical version (`X.Y.Z` or `X.Y.Z-betaN`).
  # E.g. "1.8.0" -> "1.8.1", "1.8.0-beta1" -> "1.8.1", "1.8.4-beta3" -> "1.8.5".
  def next_patch_version!(version)
    raise ArgumentError, "Invalid version '#{version}'" unless valid_version?(version)

    major, minor, patch = base_version(version).split('.').map(&:to_i)
    "#{major}.#{minor}.#{patch + 1}"
  end

  # Resolve the npm dist-tag for a given release version. Returns `'next'` for prereleases,
  # `nil` for stable (npm interprets a missing `--tag` as `latest`). Raises `ArgumentError` on
  # non-canonical input.
  def npm_dist_tag_for!(version)
    raise ArgumentError, "Invalid version '#{version}'" unless valid_version?(version)

    prerelease?(version) ? 'next' : nil
  end

  # True when the input ends with a `-betaN` suffix. Lenient: accepts version strings, tag
  # strings (`v1.7.4-beta1`), and branch names (`release/1.7.4-beta1`). Returns false for nil.
  def prerelease?(value)
    return false if value.nil?

    !!value.match?(BETA_SUFFIX)
  end

  # Strip any trailing `-betaN` suffix. Lenient: returns the input unchanged when no suffix is
  # present (so `base_version("1.7.4")` is `"1.7.4"`). Returns nil for nil input.
  def base_version(value)
    return nil if value.nil?

    value.sub(BETA_SUFFIX, '')
  end

  # Extract the trailing beta number as an Integer, or nil when the input is not a prerelease.
  # Lenient about prefixes (works on `1.7.4-beta3`, `v1.7.4-beta3`, `release/1.7.4-beta3`).
  def beta_number(value)
    return nil if value.nil?

    match = value.match(BETA_SUFFIX)
    match && match[1].to_i
  end
end
