# Shared page/perPage/total pagination for admin list endpoints. `perPage` is
# always clamped to `max_per` so a caller cannot force an unbounded query.
module AdminPagination
  extend ActiveSupport::Concern

  DEFAULT_PER_PAGE = 50
  MAX_PER_PAGE = 100
  # (MAX_PAGE - 1) * MAX_PER_PAGE stays far under Postgres's bigint range, so a huge
  # `page` (e.g. 10**30) can never overflow the OFFSET it turns into.
  MAX_PAGE = 1_000_000_000

  private

  # [page, per_page] clamped from params[:page]/params[:perPage]; non-numeric or
  # out-of-range values fall back to sane defaults rather than erroring.
  def admin_page_params(default_per: DEFAULT_PER_PAGE, max_per: MAX_PER_PAGE)
    page = positive_int(params[:page], default: 1).clamp(1, MAX_PAGE)
    per_page = positive_int(params[:perPage], default: default_per)
    [page, per_page.clamp(1, max_per)]
  end

  # Applies limit/offset to `scope` and returns [rows, meta] where meta is
  # {page:, perPage:, total:} ready to merge into the JSON response.
  def admin_paginate(scope, default_per: DEFAULT_PER_PAGE, max_per: MAX_PER_PAGE)
    page, per_page = admin_page_params(default_per:, max_per:)
    # `.count` on a scope with a custom `select` (e.g. a computed column) can produce
    # invalid SQL, so count against the unscoped-select/order version instead.
    total = scope.unscope(:select, :order).count
    rows = scope.limit(per_page).offset((page - 1) * per_page)
    [rows, { page: page, perPage: per_page, total: total }]
  end

  def positive_int(value, default:)
    return default unless value.is_a?(String) || value.is_a?(Integer)
    n = value.to_s.match?(/\A\d+\z/) ? value.to_i : nil
    n && n >= 1 ? n : default
  end
end
