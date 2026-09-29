# POST /api/link-import/draft { links: [url, …] up to 8 } -> { sources, draft, aiUsed, provenance }
#
# Public — the sign-up flow calls it before an account exists — and rate-limited per IP like
# link previews; a signed-in caller is additionally counted against LinkImport::Budget's
# per-account AI limit instead of the anonymous-per-IP one. See LinkImport::Resolver for what is
# fetched and LinkImport::ProfileDraft for how the draft is built.
class LinkImportController < ApplicationController
  DRAFTS_PER_IP = 60
  PERIOD = 10.minutes
  MAX_LINKS = 8

  def draft
    return unless throttle!("link-import-draft", limit: DRAFTS_PER_IP, period: PERIOD)

    links = Array(params[:links]).select { _1.is_a?(String) }.first(MAX_LINKS)
    return render_error("Paste at least one link.", :unprocessable_content, "INVALID_URL", fields: { links: ["Paste at least one link."] }) if links.empty?

    own_hosts = [current_user&.profile&.website, current_user&.profile&.portfolio_url].filter_map { |value| URI.parse(value.to_s).host }
    identity = current_user ? { user: current_user } : { anonymous_ip: request.remote_ip }

    result = LinkImport::ProfileDraft.build(links, own_hosts:, identity:)
    render json: result.as_json
  rescue URI::InvalidURIError
    render_error("That doesn't look like a web link.", :unprocessable_content, "INVALID_URL")
  end
end
