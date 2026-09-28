# Classifies one portfolio item's tags/roles/genres/instruments and suggests which of the
# given portfolios it best fits. Every field in the model's output is validated strictly against
# the taxonomy (roles/genres/instruments) and the given portfolio ids — anything else is dropped,
# never trusted. `AiBatchSubmitJob` builds the same prompt for the Message Batches queue and
# calls `parse` on each result; `.call` is the synchronous convenience form (used by specs and
# any caller that wants a single classification without the batch queue).
#
# A separate, non-AI `PortfolioItemClassifier` (a parallel branch's default) shares this same
# `.call(item, portfolios:)` signature and return shape; this class never depends on it existing.
class AiPortfolioItemClassifier
  SYSTEM_PROMPT = <<~PROMPT.freeze
    You classify a music portfolio item for Verse, a hiring marketplace for India's music
    industry. Reply with strict JSON only: {"tags": [string], "roles": [string], "genres":
    [string], "instruments": [string], "suggestedPortfolioIds": [string], "reasons": [string]}.
    Use only the taxonomy values and portfolio ids given to you. No other text.
  PROMPT

  def self.call(item, portfolios: []) = new(item, portfolios:).call

  def initialize(item, portfolios: [])
    @item = item
    @portfolios = portfolios
  end

  def call
    raise AiAssist::Error.new("AI assist is not enabled right now.", code: "AI_DISABLED") unless AiAssist.enabled?

    max_tokens = AiAssist.max_tokens_for("classify_portfolio_item")
    client = AiAssist.new
    result = client.suggest_raw(model: AiAssist.model_name, system_prompt: SYSTEM_PROMPT, user_prompt: prompt, max_tokens:)
    self.class.parse(result[:text], portfolios: @portfolios)
  end

  def self.build_prompt(item, portfolios: [])
    new(item, portfolios:).prompt
  end

  def prompt
    <<~PROMPT
      Title: #{@item.respond_to?(:title) ? @item.title : @item[:title]}
      Existing tags: #{Array(@item.respond_to?(:tags) ? @item.tags : @item[:tags]).join(", ")}
      Roles taxonomy: #{AutocompleteTaxonomy.values_for("roles").join(", ")}
      Genres taxonomy: #{AutocompleteTaxonomy.values_for("genres").first(40).join(", ")}
      Instruments taxonomy: #{AutocompleteTaxonomy.values_for("instruments").join(", ")}
      Portfolios (id: name): #{@portfolios.map { "#{_1[:id] || _1['id']}: #{_1[:name] || _1['name']}" }.join("; ")}
    PROMPT
  end

  # Strictly validates a raw model text response into the fixed output shape, dropping any
  # role/genre/instrument outside the taxonomy and any portfolio id not in `portfolios`.
  def self.parse(text, portfolios: [])
    parsed = JSON.parse(text.to_s)
    raise AiAssist::Error.new("The AI assistant returned something unexpected.", code: "AI_MALFORMED_RESPONSE") unless parsed.is_a?(Hash)

    known_portfolio_ids = portfolios.map { (_1[:id] || _1["id"]).to_s }
    {
      tags: Array(parsed["tags"]).map(&:to_s).first(15),
      roles: Array(parsed["roles"]).map(&:to_s).select { AutocompleteTaxonomy.values_for("roles").include?(_1) },
      genres: Array(parsed["genres"]).map(&:to_s).select { AutocompleteTaxonomy.values_for("genres").include?(_1) },
      instruments: Array(parsed["instruments"]).map(&:to_s).select { AutocompleteTaxonomy.values_for("instruments").include?(_1) },
      suggestedPortfolioIds: Array(parsed["suggestedPortfolioIds"]).map(&:to_s).select { known_portfolio_ids.include?(_1) },
      reasons: Array(parsed["reasons"]).map(&:to_s).first(5)
    }
  rescue JSON::ParserError
    raise AiAssist::Error.new("The AI assistant returned something unexpected.", code: "AI_MALFORMED_RESPONSE")
  end
end
