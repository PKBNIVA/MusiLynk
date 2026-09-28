# Keeps an owner's portfolios and resumes in step with their library and career record.
# Called after a work sample or career entry is created or edited:
# - Rule matches need nothing: membership is computed on read, so the item simply shows up.
# - Near misses (ShowcaseRules#near_miss, with what the classifier read from the item's text)
#   become pending "include" suggestions in the owning identity's inbox.
# - Values the classifier found in a work sample's text that the item lacks become one pending
#   "tags" suggestion for its owner.
# - Pending "include" suggestions that the item now meets on its own become obsolete.
module ShowcaseSync
  module_function

  def item(item) = safely(item) { sync_item(item) }
  def entry(entry) = safely(entry) { sync_entry(entry) }

  # A sync problem must never undo or fail the save that triggered it.
  def safely(record)
    yield
  rescue StandardError => error
    Rails.logger.warn({ event: "showcase_sync_failed", recordId: record.id, error: error.class.name }.to_json)
    ErrorReporter.capture(error, tags: { source: "showcase_sync" }, level: :warning, recordId: record.id)
  end

  def sync_item(item)
    portfolios = Portfolio.over_library_of(item.user_id).where(status: "active").with_owner.to_a
    result = PortfolioItemClassifier.current.classify(item, portfolios:)
    portfolios.each do |portfolio|
      if portfolio.member?(item)
        settle(portfolio, item)
      elsif (reason = result.reasons[portfolio.id]) && result.suggested_portfolio_ids.include?(portfolio.id)
        ShowcaseSuggestion.raise!(owner_type: portfolio.owner_type, owner_id: portfolio.owner_id, target: portfolio, subject: item,
          kind: "include", reason:)
      end
    end
    return unless result.any_facets?

    payload = result.facets.reject { |_facet, values| values.empty? }
    found = payload.values.flatten.first(4).join(", ")
    ShowcaseSuggestion.raise!(owner_type: "user", owner_id: item.user_id, target: item, subject: item, kind: "tags",
      reason: "Its title or description mentions #{found}", payload:)
  end

  # Career entries: a resume that asks for tags the entry's text mentions (but the entry is not
  # tagged with), or for some but not all of its tags, gets an "include" suggestion.
  def sync_entry(entry)
    resumes = Resume.where(user_id: entry.user_id).to_a
    resumes.each do |resume|
      next settle(resume, entry) if resume.member?(entry)
      next if resume.excluded?(entry)
      set = resume.rule_set
      wanted = set.vocabulary["tags"]
      text = entry.text.downcase
      inferred = { "tags" => wanted.select { |tag| text.match?(/(?<![[:alnum:]])#{Regexp.escape(tag.downcase)}(?![[:alnum:]])/) } }
      reason = set.near_miss(entry.facets, inferred, entry.year)
      next unless reason
      ShowcaseSuggestion.raise!(owner_type: "user", owner_id: entry.user_id, target: resume, subject: entry, kind: "include", reason:)
    end
  end

  # A deleted work sample: drop its id from every portfolio's pins, exclusions and manual order
  # (the ids live in jsonb, so no foreign key can do it) and its suggestions.
  def forget_item(item_id)
    Portfolio.where("pinned_item_ids @> CAST(:ids AS jsonb) OR excluded_item_ids @> CAST(:ids AS jsonb) OR item_order @> CAST(:ids AS jsonb)", ids: [item_id].to_json)
      .update_all(["pinned_item_ids = pinned_item_ids - :id, excluded_item_ids = excluded_item_ids - :id, item_order = item_order - :id, updated_at = :now",
        { id: item_id, now: Time.current }])
    ShowcaseSuggestion.where(subject_type: "portfolio_item", subject_id: item_id)
      .or(ShowcaseSuggestion.where(target_type: "portfolio_item", target_id: item_id)).delete_all
  end

  def forget_entry(entry_id)
    Resume.where("pinned_entry_ids @> CAST(:ids AS jsonb) OR excluded_entry_ids @> CAST(:ids AS jsonb) OR entry_order @> CAST(:ids AS jsonb)", ids: [entry_id].to_json)
      .update_all(["pinned_entry_ids = pinned_entry_ids - :id, excluded_entry_ids = excluded_entry_ids - :id, entry_order = entry_order - :id, updated_at = :now",
        { id: entry_id, now: Time.current }])
    ShowcaseSuggestion.where(subject_type: "career_entry", subject_id: entry_id).delete_all
  end

  def settle(target, subject)
    ShowcaseSuggestion.pending.where(target_type: ShowcaseSuggestion.type_name(target), target_id: target.id,
      subject_type: ShowcaseSuggestion.type_name(subject), subject_id: subject.id, kind: "include")
      .update_all(status: "obsolete", resolved_at: Time.current, updated_at: Time.current)
  end
end
