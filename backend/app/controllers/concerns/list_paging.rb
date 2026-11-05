# Cursor paging for ranked lists (talent, candidates, acts, global search by type, and job search
# with a query). Same contract as the job list: `?limit=` (default PAGE_SIZE, 1..MAX_PAGE_SIZE) and
# `?cursor=` from the previous page's `nextCursor`; responses add `nextCursor` and `total`.
# The cursor is opaque to clients; here it holds the offset of the next row.
module ListPaging
  PAGE_SIZE = Limits.list_page_size
  MAX_PAGE_SIZE = Limits.list_max_page_size

  private

  # A whole number is clamped to 1..MAX_PAGE_SIZE; a missing or unreadable one means the default.
  def list_limit(default = PAGE_SIZE)
    Integer(params[:limit].to_s, 10).clamp(1, MAX_PAGE_SIZE)
  rescue ArgumentError
    default
  end

  # 0 without a cursor, nil when it cannot be read.
  def list_offset
    raw = params[:cursor]
    return 0 if raw.blank?
    offset = JSON.parse(Base64.urlsafe_decode64(raw.to_s))["offset"] if raw.is_a?(String)
    offset.is_a?(Integer) && offset >= 0 ? offset : nil
  rescue ArgumentError, JSON::ParserError, TypeError, NoMethodError
    nil
  end

  def encode_list_cursor(offset) = Base64.urlsafe_encode64({ offset: }.to_json, padding: false)

  def render_invalid_cursor
    render_error("This list position is no longer valid. Start the search again.", :bad_request, "INVALID_CURSOR")
  end

  # The cursor for the page after a Search::Runner result, or nil on the last page.
  def list_next_cursor(search, offset, limit) = search.more ? encode_list_cursor(offset + limit) : nil
end
