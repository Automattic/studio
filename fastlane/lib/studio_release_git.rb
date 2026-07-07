# frozen_string_literal: true

require 'open3'
require 'json'

# Pure-Ruby git helpers used by the wp-studio npm release lanes.
#
# Each helper shells out to git via Open3 (not fastlane's `sh`), so missing files / failed
# commands return nil instead of raising. That makes them safe to call inside iterating loops
# and testable from pure Ruby with a fixture git repo.
#
# See fastlane/test/studio_release_git_test.rb.
module StudioReleaseGit
  NPM_RELEASE_PACKAGE_JSON_PATHS = [
    'apps/studio/package.json',
    'apps/cli/package.json'
  ].freeze

  module_function

  # Read the `version` field from `<commit>:<path>`. Returns nil if the file does not exist at
  # the commit, the `git show` command fails, or the contents are not valid JSON.
  def package_json_version_at(commit:, path:)
    output, _stderr, status = Open3.capture3('git', 'show', "#{commit}:#{path}")
    return nil unless status.success?

    JSON.parse(output)['version']
  rescue JSON::ParserError
    nil
  end

  # Resolve a remote tag to the commit it points at. Handles both lightweight and annotated
  # tags by querying both the bare ref and the peeled (`^{}`) ref, and preferring the peeled
  # commit SHA when present (annotated tags' bare ref is the tag-object SHA, not the commit).
  # Returns nil if the tag does not exist on the remote or the lookup fails.
  def remote_tag_commit_sha(tag, remote: 'origin')
    output, _stderr, status = Open3.capture3(
      'git', 'ls-remote', remote,
      "refs/tags/#{tag}", "refs/tags/#{tag}^{}"
    )
    return nil unless status.success?

    output = output.strip
    return nil if output.empty?

    lines = output.lines
    peeled = lines.find { |l| l.include?('^{}') }
    (peeled || lines.first).split.first
  end

  # Find the commit on `branch` (typically `origin/trunk`) that introduced `version` into every
  # path in `paths`. Returns the commit SHA, or nil if no such commit exists.
  #
  # `git log -S` reports any commit that *changes the count* of the search string in the file.
  # That includes both the commit that introduces the version (count 0 → 1) and a later commit
  # that bumps away from it (count 1 → 0). Walking candidates newest-to-oldest and returning
  # the first commit where every path's package.json actually declares the requested version
  # picks the introduction (the bump-away candidate fails the predicate, as do half-applied
  # bumps where only one workspace is at the target version).
  #
  # The search anchor (`-- <path>` argument to `git log`) is the first entry in `paths`.
  def find_npm_release_bump_commit!(branch:, version:, paths: NPM_RELEASE_PACKAGE_JSON_PATHS)
    raise ArgumentError, 'paths must not be empty' if paths.empty?

    search = "\"version\": \"#{version}\""
    output, _stderr, status = Open3.capture3(
      'git', 'log', '--format=%H', '-S', search, branch,
      '--', paths.first
    )
    return nil unless status.success?
    return nil if output.strip.empty?

    output.lines.map(&:strip).find do |sha|
      paths.all? { |path| package_json_version_at(commit: sha, path: path) == version }
    end
  end
end
