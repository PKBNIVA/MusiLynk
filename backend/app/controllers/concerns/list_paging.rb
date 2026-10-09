# Cursor paging for ranked lists (talent, candidates, acts, global search by type, and job search
# with a query). Same contract as the job list: `?limit=` (default PAGE_SIZE, 1..MAX_PAGE_SIZE) and
# `?cursor=` from the previous page's `nextCursor`; responses add `nextCursor` and `total`.
# The cursor is opaque to clients; here it holds the offset of the next row.
module ListPaging
  PAGE_SIZE = 30
  MAX_PAGE_SIZE = 100
  # Bounds for decoded keyset cursors: a tampered value outside them is INVALID_CURSOR (400), never a
  # database error. Ranks are small packed integers (TalentRank); timestamps sit well inside Postgres' range.
  MAX_CURSOR_RANK = 1_000_000
  CURSOR_YEARS = (2000..2100).freeze

  # An ISO 8601 cursor timestamp inside CURSOR_YEARS, or nil when it cannot be read or is out of range.
  def self.cursor_time(raw)
    return nil unless raw.is_a?(String) && raw.length <= 40
    time = Time.iso8601(raw)
    CURSOR_YEARS.cover?(time.utc.year) ? time : nil
  rescue ArgumentError
    nil
  end

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

  # Keyset cursors (R4) hold the last row's sort key instead: `{ "k": [rank, id] }`.
  def encode_keyset_cursor(*key) = Base64.urlsafe_encode64({ k: key }.to_json, padding: false)

  # Where the page starts: { offset: 0, key: nil } without a cursor, { offset: 0, key: [rank, id] }
  # for a keyset cursor, { offset: n, key: nil } for an offset cursor, nil when it cannot be read.
  def list_position
    raw = params[:cursor]
    return { offset: 0, key: nil } if raw.blank?
    data = JSON.parse(Base64.urlsafe_decode64(raw.to_s)) if raw.is_a?(String)
    return nil unless data.is_a?(Hash)
    if data.key?("k")
      key = data["k"]
      valid = key.is_a?(Array) && key.length == 2 && key[0].is_a?(Integer) && key[0].between?(0, MAX_CURSOR_RANK) && key[1].is_a?(String) && key[1].length <= 64
      return valid ? { offset: 0, key: } : nil
    end
    offset = data["offset"]
    offset.is_a?(Integer) && offset >= 0 ? { offset:, key: nil } : nil
  rescue ArgumentError, JSON::ParserError, TypeError, NoMethodError
    nil
  end

  # Offset cursors on keyset-paged lists are accepted for one release (R4, 2026-10-09); this line
  # counts the clients still sending them before the fallback is removed.
  def deprecated_offset_cursor!(list)
    Rails.logger.info({ event: "deprecated_offset_cursor", list: }.to_json)
  end

  def render_invalid_cursor
    render_error("This list position is no longer valid. Start the search again.", :bad_request, "INVALID_CURSOR")
  end

  # The cursor for the page after a Search::Runner result, or nil on the last page.
  def list_next_cursor(search, offset, limit) = search.more ? encode_list_cursor(offset + limit) : nil
end
