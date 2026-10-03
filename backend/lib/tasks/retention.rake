namespace :retention do
  desc "Show what the nightly retention sweep would delete now (DRY_RUN=0 deletes; ONLY=rule[,rule])"
  task sweep: :environment do
    dry_run = ENV.fetch("DRY_RUN", "1") != "0"
    only = ENV["ONLY"].to_s.split(",").map(&:strip).reject(&:empty?).presence || Retention::RULES.keys
    unknown = only - Retention::RULES.keys
    abort "retention:sweep: unknown rule(s) #{unknown.join(', ')}; known: #{Retention::RULES.keys.join(', ')}" if unknown.any?
    Retention.sweep(dry_run:, only:).each do |outcome|
      puts format("%-28s %s %d%s", outcome.rule, dry_run ? "would delete" : "deleted", outcome.count, outcome.capped ? " (cap reached; more next run)" : "")
    end
  end
end
