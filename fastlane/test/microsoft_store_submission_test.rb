# frozen_string_literal: true

# Sanity checks for fastlane/lib/microsoft_store_submission.rb. Every HTTP call goes through a fake
# transport, so nothing reaches Microsoft. Run with:
#
#   ruby fastlane/test/microsoft_store_submission_test.rb

require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'fileutils'
require_relative '../lib/microsoft_store_submission'

class MicrosoftStoreSubmissionTest < Minitest::Test
  APP_ID = '9PNTBL35PZVS'
  API = "https://manage.devcenter.microsoft.com/v1.0/my/applications/#{APP_ID}".freeze
  UPLOAD_URL = 'https://productingestionbin1.blob.core.windows.net/ingestion/abc?sv=2014-02-14&sr=b&sig=a+b%3D&sp=rwl'

  # Records requests and answers them from a list of [method, url-prefix, response] routes. A route
  # is consumed when it matches, so repeated calls (like status polling) can return different bodies.
  class FakeHttp
    attr_reader :requests

    def initialize(routes)
      @routes = routes
      @requests = []
    end

    def request(method, url, headers: {}, body: nil)
      @requests << { method: method, url: url, headers: headers, body: body }
      index = @routes.index { |m, prefix, _| m == method && url.start_with?(prefix) }
      raise "Unexpected request: #{method.upcase} #{url}" unless index

      status, response_body = @routes.delete_at(index)[2]
      MicrosoftStoreSubmission::Response.new(status: status, body: response_body.is_a?(String) ? response_body : response_body&.to_json)
    end
  end

  def setup
    @dir = Dir.mktmpdir('ms-store-test-')
    @zip_path = File.join(@dir, 'packages.zip')
    File.binwrite(@zip_path, 'x' * (MicrosoftStoreSubmission::BLOCK_SIZE + 10))
    @sleeps = []
  end

  def teardown
    FileUtils.rm_rf(@dir)
  end

  def build_client(routes)
    @http = FakeHttp.new(routes)
    MicrosoftStoreSubmission.new(
      tenant_id: 'tenant', client_id: 'client', client_secret: 'secret', application_id: APP_ID,
      http: @http, sleeper: ->(seconds) { @sleeps << seconds }
    )
  end

  def token_route
    [:post, 'https://login.microsoftonline.com/tenant/oauth2/token', [200, { access_token: 'tok' }]]
  end

  def new_submission
    {
      'id' => '111',
      'friendlyName' => 'Submission 9',
      'fileUploadUrl' => UPLOAD_URL,
      'applicationPackages' => [{ 'id' => 'old', 'fileName' => 'Studio 2.0.0.0 unsigned.appx', 'fileStatus' => 'Uploaded' }]
    }
  end

  def happy_routes(app: {}, statuses: ['PreProcessing'])
    [
      token_route,
      [:get, API, [200, app]],
      [:post, "#{API}/submissions/111/commit", [202, { status: 'CommitStarted' }]],
      [:post, "#{API}/submissions", [201, new_submission]],
      [:put, "#{API}/submissions/111", [200, {}]],
      [:put, "#{UPLOAD_URL.gsub('+', '%2B')}&comp=block&", [201, '']],
      [:put, "#{UPLOAD_URL.gsub('+', '%2B')}&comp=block&", [201, '']],
      [:put, "#{UPLOAD_URL.gsub('+', '%2B')}&comp=blocklist", [201, '']]
    ] + statuses.map { |status| [:get, "#{API}/submissions/111/status", [200, { status: status }]] }
  end

  def test_submit_replaces_packages_uploads_and_commits
    client = build_client(happy_routes(statuses: %w[CommitStarted PreProcessing]))

    result = client.submit(packages: ['Studio-2.1.0.0-x64.appx', 'Studio-2.1.0.0-arm64.appx'], zip_path: @zip_path)

    assert_equal({ submission_id: '111', status: 'PreProcessing' }, result)
    assert_equal [30], @sleeps

    update = @http.requests.find { |r| r[:method] == :put && r[:url] == "#{API}/submissions/111" }
    packages = JSON.parse(update[:body])['applicationPackages']
    assert_equal([['Studio 2.0.0.0 unsigned.appx', 'PendingDelete'], %w[Studio-2.1.0.0-x64.appx PendingUpload], %w[Studio-2.1.0.0-arm64.appx PendingUpload]],
                 packages.map { |p| [p['fileName'], p['fileStatus']] })
    assert_equal 'Bearer tok', update[:headers]['Authorization']

    methods_in_order = @http.requests.map { |r| [r[:method], r[:url].sub(API, '').sub(/\?.*/, '?')] }
    assert_operator(methods_in_order.index([:put, '/submissions/111']), :<, methods_in_order.index { |m, u| m == :put && u.include?('blob.core') })
    assert_equal [:post, '/submissions/111/commit'], methods_in_order[-3]

    blocks = @http.requests.select { |r| r[:url].include?('comp=block&') }
    assert_equal([MicrosoftStoreSubmission::BLOCK_SIZE, 10], blocks.map { |r| r[:body].bytesize })
    block_list = @http.requests.find { |r| r[:url].end_with?('comp=blocklist') }[:body]
    assert_includes block_list, "<Latest>#{MicrosoftStoreSubmission.block_id(0)}</Latest><Latest>#{MicrosoftStoreSubmission.block_id(1)}</Latest>"
  end

  def test_submit_fails_on_pending_submission
    client = build_client([token_route, [:get, API, [200, { pendingApplicationSubmission: { id: '999' } }]]])

    error = assert_raises(MicrosoftStoreSubmission::PendingSubmissionError) do
      client.submit(packages: ['a.appx'], zip_path: @zip_path)
    end
    assert_equal '999', error.submission_id
  end

  def test_submit_can_discard_pending_submission
    routes = happy_routes(app: { pendingApplicationSubmission: { id: '999' } })
    routes << [:delete, "#{API}/submissions/999", [204, '']]
    client = build_client(routes)

    assert_equal 'PreProcessing', client.submit(packages: ['a.appx'], zip_path: @zip_path, discard_pending_submission: true)[:status]
    assert(@http.requests.any? { |r| r[:method] == :delete && r[:url].end_with?('/submissions/999') })
  end

  def test_submit_reports_commit_failure_details
    routes = happy_routes(statuses: [])
    routes << [:get, "#{API}/submissions/111/status",
               [200, { status: 'CommitFailed', statusDetails: { errors: [{ code: 'InvalidParameterValue', details: 'bad package' }] } }]]
    client = build_client(routes)

    error = assert_raises(MicrosoftStoreSubmission::Error) { client.submit(packages: ['a.appx'], zip_path: @zip_path) }
    assert_includes error.message, 'InvalidParameterValue: bad package'
  end

  def test_api_errors_include_status_and_body
    client = build_client([token_route, [:get, API, [401, 'nope']]])

    error = assert_raises(MicrosoftStoreSubmission::Error) { client.submit(packages: ['a.appx'], zip_path: @zip_path) }
    assert_includes error.message, 'HTTP 401 nope'
  end

  def test_package_urls_round_trip_through_release_body
    urls = ['https://cdn.example/Studio%202.1.0.0%20x64.appx', 'https://cdn.example/arm64.appx']
    body = "Notes\n\n<!-- CDN_POST_IDS:1,2 -->\n#{MicrosoftStoreSubmission.release_body_marker(urls)}"

    assert_equal urls, MicrosoftStoreSubmission.package_urls_from_release_body(body)
    assert_empty MicrosoftStoreSubmission.package_urls_from_release_body('no marker')
    assert_empty MicrosoftStoreSubmission.package_urls_from_release_body(nil)
  end

  def test_block_ids_have_equal_length
    assert_equal MicrosoftStoreSubmission.block_id(0).length, MicrosoftStoreSubmission.block_id(123_456).length
  end
end
