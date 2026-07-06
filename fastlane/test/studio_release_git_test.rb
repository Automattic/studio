# frozen_string_literal: true

# Sanity checks for fastlane/lib/studio_release_git.rb.
#
# Each test builds a temporary git repo (with a sibling bare repo as `origin`) and exercises
# the helpers against real git history. Run with:
#
#   ruby fastlane/test/studio_release_git_test.rb
#
# (Requires a working `git` on PATH; Minitest + Open3 + Tmpdir are stdlib.)

require 'minitest/autorun'
require 'fileutils'
require 'tmpdir'
require 'open3'
require 'json'
require_relative '../lib/studio_release_git'

class StudioReleaseGitTest < Minitest::Test
  def setup
    @workdir = Dir.mktmpdir('studio-release-git-test-')
    @repo = File.join(@workdir, 'repo')
    @remote = File.join(@workdir, 'remote.git')
    @prev_dir = Dir.pwd
    init_remote
    init_repo
    Dir.chdir(@repo)
  end

  def teardown
    Dir.chdir(@prev_dir) if @prev_dir
    FileUtils.rm_rf(@workdir)
  end

  # ---------- package_json_version_at ----------

  def test_package_json_version_at_returns_version
    sha = commit_packages(studio: '1.2.3', cli: '1.2.3', message: 'first')
    assert_equal '1.2.3', StudioReleaseGit.package_json_version_at(commit: sha, path: 'apps/studio/package.json')
    assert_equal '1.2.3', StudioReleaseGit.package_json_version_at(commit: sha, path: 'apps/cli/package.json')
  end

  def test_package_json_version_at_returns_nil_for_missing_path_at_commit
    sha = commit_file('apps/studio/package.json', JSON.pretty_generate(version: '1.2.3'), 'studio only')
    # apps/cli/package.json doesn't exist at this commit.
    assert_nil StudioReleaseGit.package_json_version_at(commit: sha, path: 'apps/cli/package.json')
  end

  def test_package_json_version_at_returns_nil_for_invalid_json
    sha = commit_file('apps/studio/package.json', 'not json', 'invalid')
    assert_nil StudioReleaseGit.package_json_version_at(commit: sha, path: 'apps/studio/package.json')
  end

  def test_package_json_version_at_returns_nil_for_unknown_commit
    commit_packages(studio: '1.2.3', cli: '1.2.3', message: 'first')
    assert_nil StudioReleaseGit.package_json_version_at(commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
                                                       path: 'apps/studio/package.json')
  end

  # ---------- remote_tag_commit_sha ----------

  def test_remote_tag_commit_sha_resolves_lightweight_tag
    sha = commit_packages(studio: '1.0.0', cli: '1.0.0', message: 'first')
    run_git('tag', 'v1.0.0') # lightweight: no -a, no -m
    push_to_remote('v1.0.0')

    assert_equal sha, StudioReleaseGit.remote_tag_commit_sha('v1.0.0', remote: 'origin')
  end

  def test_remote_tag_commit_sha_resolves_annotated_tag
    sha = commit_packages(studio: '1.0.0', cli: '1.0.0', message: 'first')
    run_git('tag', '-a', '-m', 'release v1.0.0', 'v1.0.0') # annotated
    push_to_remote('v1.0.0')

    assert_equal sha, StudioReleaseGit.remote_tag_commit_sha('v1.0.0', remote: 'origin'),
                 'annotated tag must resolve to the *commit* via the peeled ^{} ref, ' \
                 'not the tag-object SHA returned by the bare ref'
  end

  def test_remote_tag_commit_sha_returns_nil_for_missing_tag
    commit_packages(studio: '1.0.0', cli: '1.0.0', message: 'first')
    assert_nil StudioReleaseGit.remote_tag_commit_sha('v999.999.999', remote: 'origin')
  end

  # ---------- find_npm_release_bump_commit ----------

  def test_find_returns_introduction_commit_not_deletion
    # 1.0.0 -> 1.0.1 -> 1.0.2: searching for 1.0.1 must return the intro of 1.0.1, not the
    # later 1.0.2 commit (which deleted the "1.0.1" line from studio's package.json).
    commit_packages(studio: '1.0.0', cli: '1.0.0', message: 'bump to 1.0.0')
    sha_intro = commit_packages(studio: '1.0.1', cli: '1.0.1', message: 'bump to 1.0.1')
    commit_packages(studio: '1.0.2', cli: '1.0.2', message: 'bump to 1.0.2')

    result = StudioReleaseGit.find_npm_release_bump_commit!(branch: 'HEAD', version: '1.0.1')
    assert_equal sha_intro, result
  end

  def test_find_returns_nil_when_no_commit_has_both_workspaces_at_version
    # Half-applied bump: only studio touched, cli stays old. No candidate satisfies both.
    commit_packages(studio: '1.0.0', cli: '1.0.0', message: 'first')
    commit_packages(studio: '1.0.1', cli: '1.0.0', message: 'half-applied')

    result = StudioReleaseGit.find_npm_release_bump_commit!(branch: 'HEAD', version: '1.0.1')
    assert_nil result
  end

  def test_find_walks_past_half_applied_to_full_introduction
    # Sequence:
    #   A: studio=1.0.0, cli=1.0.0
    #   B: studio=1.0.1, cli=1.0.1   <- the introduction we want
    #   C: studio=1.0.2, cli=1.0.1   <- studio bumped past 1.0.1; -S finds C as a candidate
    #
    # `git log -S '"version": "1.0.1"' -- apps/studio/package.json` returns C and B in order.
    # C fails the all-workspaces predicate (studio=1.0.2 ≠ 1.0.1); B satisfies it.
    commit_packages(studio: '1.0.0', cli: '1.0.0', message: 'A')
    sha_intro = commit_packages(studio: '1.0.1', cli: '1.0.1', message: 'B')
    commit_packages(studio: '1.0.2', cli: '1.0.1', message: 'C')

    result = StudioReleaseGit.find_npm_release_bump_commit!(branch: 'HEAD', version: '1.0.1')
    assert_equal sha_intro, result
  end

  def test_find_returns_nil_for_unknown_version
    commit_packages(studio: '1.0.0', cli: '1.0.0', message: 'first')
    result = StudioReleaseGit.find_npm_release_bump_commit!(branch: 'HEAD', version: '99.99.99')
    assert_nil result
  end

  def test_find_raises_for_empty_paths
    assert_raises(ArgumentError) do
      StudioReleaseGit.find_npm_release_bump_commit!(branch: 'HEAD', version: '1.0.0', paths: [])
    end
  end

  def test_find_supports_custom_paths
    # Drive find_npm_release_bump_commit against a different workspace layout so we know the
    # `paths:` parameter is honored end-to-end (search anchor + verify list).
    in_repo do
      FileUtils.mkdir_p('packages/foo')
      File.write('packages/foo/package.json', JSON.pretty_generate(version: '0.1.0'))
      run_git('add', 'packages/foo/package.json')
      run_git('commit', '-m', 'add foo at 0.1.0')
    end
    sha_intro = `git rev-parse HEAD`.strip

    in_repo do
      File.write('packages/foo/package.json', JSON.pretty_generate(version: '0.2.0'))
      run_git('commit', '-am', 'bump foo to 0.2.0')
    end

    result = StudioReleaseGit.find_npm_release_bump_commit!(
      branch: 'HEAD', version: '0.1.0', paths: ['packages/foo/package.json']
    )
    assert_equal sha_intro, result
  end

  private

  def init_remote
    FileUtils.mkdir_p(@remote)
    Dir.chdir(@remote) { run_git_quiet('init', '--bare') }
  end

  def init_repo
    FileUtils.mkdir_p(@repo)
    Dir.chdir(@repo) do
      run_git_quiet('init')
      run_git_quiet('config', 'user.email', 'test@example.com')
      run_git_quiet('config', 'user.name', 'Studio Release Test')
      run_git_quiet('config', 'commit.gpgsign', 'false')
      run_git_quiet('remote', 'add', 'origin', @remote)
    end
  end

  def in_repo(&blk)
    Dir.chdir(@repo, &blk)
  end

  def run_git(*args)
    output, status = Open3.capture2e('git', *args)
    raise "git #{args.join(' ')} failed (#{status.exitstatus}):\n#{output}" unless status.success?

    output
  end

  def run_git_quiet(*args)
    Open3.capture2e('git', *args)
  end

  def commit_file(path, content, message)
    in_repo do
      FileUtils.mkdir_p(File.dirname(path))
      File.write(path, content)
      run_git('add', path)
      run_git('commit', '-m', message)
      `git rev-parse HEAD`.strip
    end
  end

  def commit_packages(studio:, cli:, message:)
    in_repo do
      FileUtils.mkdir_p('apps/studio')
      FileUtils.mkdir_p('apps/cli')
      File.write('apps/studio/package.json', JSON.pretty_generate(name: 'studio-app', version: studio))
      File.write('apps/cli/package.json', JSON.pretty_generate(name: 'wp-studio', version: cli))
      run_git('add', 'apps/studio/package.json', 'apps/cli/package.json')
      run_git('commit', '-m', message)
      `git rev-parse HEAD`.strip
    end
  end

  def push_to_remote(refname)
    in_repo { run_git('push', 'origin', refname) }
  end
end
