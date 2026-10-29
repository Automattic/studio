# frozen_string_literal: true

require 'json'
require 'net/http'
require 'uri'

# Client for the Microsoft Store submission API, used to replace the packages of the Studio
# listing with the ones from a new release.
#
# Flow (https://learn.microsoft.com/windows/uwp/monetize/manage-app-submissions):
#   1. Get an Entra ID token for the Partner Center client (client credentials grant).
#   2. Create a submission. The Store clones the last published submission, so listings,
#      pricing and age ratings carry over.
#   3. Update it: mark the existing packages `PendingDelete` and add the new ones as `PendingUpload`.
#   4. Upload a ZIP holding the packages to the submission's SAS URL.
#   5. Commit, then poll until the status leaves `CommitStarted`.
#
# Only stdlib is used so the class can be unit-tested without booting fastlane. HTTP goes through
# an injectable `http` object (see {NetHttpTransport}) so tests can fake every call.
# See fastlane/test/microsoft_store_submission_test.rb.
class MicrosoftStoreSubmission
  API_BASE = 'https://manage.devcenter.microsoft.com/v1.0/my'
  TOKEN_RESOURCE = 'https://manage.devcenter.microsoft.com'
  # Put Block accepts up to 4 MiB on every storage service version, including the old ones the
  # Store's SAS URLs are signed with, so chunked uploads work regardless of package size.
  BLOCK_SIZE = 4 * 1024 * 1024
  COMMIT_POLL_INTERVAL = 30
  COMMIT_TIMEOUT = 30 * 60

  Response = Struct.new(:status, :body, keyword_init: true)

  class Error < StandardError; end

  # A submission that hasn't been published yet already exists. The API only allows one at a time.
  class PendingSubmissionError < Error
    attr_reader :submission_id

    def initialize(submission_id)
      @submission_id = submission_id
      super("A pending submission (#{submission_id}) already exists for this app. Finish or delete it in Partner Center, " \
            'or re-run with discard_pending_submission:true to delete it.')
    end
  end

  attr_reader :application_id

  def initialize(tenant_id:, client_id:, client_secret:, application_id:, http: NetHttpTransport.new,
                 sleeper: ->(seconds) { sleep(seconds) }, logger: ->(_message) {})
    @tenant_id = tenant_id
    @client_id = client_id
    @client_secret = client_secret
    @application_id = application_id
    @http = http
    @sleeper = sleeper
    @logger = logger
  end

  # Submit the given packages as a new version of the app.
  #
  # @param packages [Array<String>] File names of the packages, as they appear at the root of the ZIP.
  # @param zip_path [String] Path to the ZIP that holds the packages.
  # @param discard_pending_submission [Boolean] Delete an existing pending submission instead of failing.
  # @return [Hash] `{ submission_id:, status: }`, where status is the first status after `CommitStarted`.
  def submit(packages:, zip_path:, discard_pending_submission: false)
    raise ArgumentError, 'No packages to submit' if packages.empty?

    pending_id = pending_submission_id
    if pending_id
      raise PendingSubmissionError, pending_id unless discard_pending_submission

      log("Deleting pending submission #{pending_id}")
      delete_submission(pending_id)
    end

    submission = create_submission
    submission_id = submission.fetch('id')
    log("Created submission #{submission_id} (#{submission['friendlyName']})")

    update_submission(submission_id, self.class.replace_packages(submission, packages))
    upload_zip(file_upload_url: submission.fetch('fileUploadUrl'), zip_path: zip_path)
    commit_submission(submission_id)
    status = wait_for_commit(submission_id)
    { submission_id: submission_id, status: status }
  end

  # Return a copy of the submission body with every existing package marked for deletion and the new
  # packages added for upload. Read-only fields like `fileUploadUrl` are left in: the API ignores them.
  def self.replace_packages(submission, packages)
    existing = (submission['applicationPackages'] || []).map { |package| package.merge('fileStatus' => 'PendingDelete') }
    added = packages.map do |file_name|
      { 'fileName' => file_name, 'fileStatus' => 'PendingUpload', 'minimumDirectXVersion' => 'None', 'minimumSystemRam' => 'None' }
    end
    submission.merge('applicationPackages' => existing + added)
  end

  # Block IDs must all have the same length before Base64 encoding.
  def self.block_id(index)
    [format('block-%06d', index)].pack('m0')
  end

  def self.block_list_xml(block_ids)
    latest = block_ids.map { |id| "<Latest>#{id}</Latest>" }.join
    %(<?xml version="1.0" encoding="utf-8"?><BlockList>#{latest}</BlockList>)
  end

  # The SAS signature can contain a literal `+`, which Azure would read as a space. Microsoft's own
  # samples escape it before uploading.
  def self.escape_sas_url(url)
    url.gsub('+', '%2B')
  end

  PACKAGES_MARKER = /<!-- MS_STORE_PACKAGES:(\S+(?: \S+)*) -->/

  # HTML comment embedded in the GitHub release body by `create_draft_github_release`, so the publish
  # step (a separate Buildkite build) can find the Store packages on the CDN.
  def self.release_body_marker(package_urls)
    "<!-- MS_STORE_PACKAGES:#{package_urls.join(' ')} -->"
  end

  def self.package_urls_from_release_body(body)
    match = body.to_s.match(PACKAGES_MARKER)
    match ? match[1].split : []
  end

  private

  def log(message)
    @logger.call(message)
  end

  def access_token
    @access_token ||= begin
      response = @http.request(
        :post,
        "https://login.microsoftonline.com/#{@tenant_id}/oauth2/token",
        headers: { 'Content-Type' => 'application/x-www-form-urlencoded' },
        body: URI.encode_www_form(
          grant_type: 'client_credentials',
          client_id: @client_id,
          client_secret: @client_secret,
          resource: TOKEN_RESOURCE
        )
      )
      ensure_success!(response, 'getting an access token')
      JSON.parse(response.body).fetch('access_token')
    end
  end

  def api(method, path, body: nil)
    headers = { 'Authorization' => "Bearer #{access_token}" }
    headers['Content-Type'] = 'application/json' unless body.nil?
    response = @http.request(method, "#{API_BASE}/applications/#{@application_id}#{path}", headers: headers, body: body&.to_json)
    ensure_success!(response, "#{method.upcase} applications/#{@application_id}#{path}")
    response.body.nil? || response.body.empty? ? {} : JSON.parse(response.body)
  end

  def ensure_success!(response, action)
    return if response.status.between?(200, 299)

    raise Error, "Microsoft Store API error while #{action}: HTTP #{response.status} #{response.body}"
  end

  def pending_submission_id
    api(:get, '').dig('pendingApplicationSubmission', 'id')
  end

  def delete_submission(submission_id)
    api(:delete, "/submissions/#{submission_id}")
  end

  def create_submission
    api(:post, '/submissions')
  end

  def update_submission(submission_id, body)
    api(:put, "/submissions/#{submission_id}", body: body)
  end

  def commit_submission(submission_id)
    api(:post, "/submissions/#{submission_id}/commit")
  end

  def wait_for_commit(submission_id)
    waited = 0
    loop do
      response = api(:get, "/submissions/#{submission_id}/status")
      status = response['status']
      case status
      when 'CommitStarted'
        raise Error, "Submission #{submission_id} is still committing after #{COMMIT_TIMEOUT / 60} minutes; check Partner Center." if waited >= COMMIT_TIMEOUT

        @sleeper.call(COMMIT_POLL_INTERVAL)
        waited += COMMIT_POLL_INTERVAL
      when 'CommitFailed'
        errors = response.dig('statusDetails', 'errors') || []
        details = errors.map { |e| "#{e['code']}: #{e['details']}" }.join('; ')
        raise Error, "Submission #{submission_id} failed to commit: #{details.empty? ? response.to_json : details}"
      else
        return status
      end
    end
  end

  def upload_zip(file_upload_url:, zip_path:)
    url = self.class.escape_sas_url(file_upload_url)
    block_ids = []
    File.open(zip_path, 'rb') do |file|
      while (chunk = file.read(BLOCK_SIZE))
        block_id = self.class.block_id(block_ids.size)
        response = @http.request(:put, "#{url}&comp=block&blockid=#{URI.encode_www_form_component(block_id)}",
                                 headers: { 'Content-Type' => 'application/octet-stream' }, body: chunk)
        ensure_success!(response, "uploading block #{block_ids.size}")
        block_ids << block_id
      end
    end
    raise Error, "#{zip_path} is empty" if block_ids.empty?

    response = @http.request(:put, "#{url}&comp=blocklist",
                             headers: { 'Content-Type' => 'application/xml' }, body: self.class.block_list_xml(block_ids))
    ensure_success!(response, 'committing the uploaded blocks')
    log("Uploaded #{File.basename(zip_path)} in #{block_ids.size} blocks")
  end

  # Minimal Net::HTTP transport. Each call opens its own connection, which is fine for the handful of
  # API calls and the few hundred 4 MiB blocks a release needs.
  class NetHttpTransport
    METHODS = {
      get: Net::HTTP::Get,
      post: Net::HTTP::Post,
      put: Net::HTTP::Put,
      delete: Net::HTTP::Delete
    }.freeze

    def request(method, url, headers: {}, body: nil)
      uri = URI(url)
      request = METHODS.fetch(method).new(uri)
      headers.each { |key, value| request[key] = value }
      request.body = body || ''
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', read_timeout: 300) do |http|
        http.request(request)
      end
      Response.new(status: response.code.to_i, body: response.body)
    end
  end
end
