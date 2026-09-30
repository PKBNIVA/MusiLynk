namespace :demo do
  desc "Seed the Verse showcase: 110 musicians and 40 hirers with their activity (batch demo-showcase). A no-op when the batch already exists."
  task showcase: :environment do
    # Safe in production: needs no ALLOW_SYNTHETIC_QA, only touches the demo-* batch it names, and refuses
    # to grow the demo population past SyntheticQa::Demo::MAX_USERS. Remove it again from Admin -> Demo data.
    batch = ENV.fetch("BATCH", SyntheticQa::Demo::SHOWCASE_BATCH)
    outcome = SyntheticQa::Demo.with_admin_lock { SyntheticQa::Showcase.call(batch:) }
    abort "demo:showcase: another demo data job holds the lock; nothing was changed." if outcome == :locked

    if outcome.skipped
      puts "demo:showcase: #{batch} already exists (#{User.synthetic(batch).count} accounts); nothing to do."
    else
      puts "demo:showcase: seeded #{outcome.batch}: #{outcome.to_h.except(:batch, :skipped).to_json}"
    end
    Rails.logger.info({ event: "demo_showcase.task", batch:, skipped: outcome.skipped }.to_json)
  end
end
