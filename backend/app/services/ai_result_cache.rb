require "digest"

# Caches a task's suggestion per (task, normalized context, account) for AiPricing.cache_ttl
# (24h default): an identical request within the window returns the cached suggestion with no
# API call. `regenerate: true` bypasses both the read and the write, so "Try again" always calls
# the model.
class AiResultCache
  def self.key_for(task, context, account_type, account_id)
    normalized = normalize(context)
    digest = Digest::SHA256.hexdigest(normalized.to_json)
    "ai-cache:v1:#{account_type}:#{account_id}:#{task}:#{digest}"
  end

  # Order-independent, whitespace-trimmed, string-keyed — so equivalent requests (different key
  # order, incidental whitespace) share a cache entry.
  def self.normalize(context)
    return context unless context.is_a?(Hash)

    context.each_with_object({}) { |(k, v), out| out[k.to_s] = normalize_value(v) }.sort.to_h
  end

  def self.normalize_value(value)
    case value
    when Hash then normalize(value)
    when Array then value.map { normalize_value(_1) }
    when String then value.strip
    else value
    end
  end

  def self.fetch(task, context, account_type, account_id, regenerate: false)
    return nil if regenerate

    Rails.cache.read(key_for(task, context, account_type, account_id))
  end

  def self.write(task, context, account_type, account_id, result, regenerate: false)
    return result if regenerate

    Rails.cache.write(key_for(task, context, account_type, account_id), result, expires_in: AiPricing.cache_ttl)
    result
  end
end
