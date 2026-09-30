namespace :demo do
  desc "Seed the Verse showcase: 110 musicians and 40 hirers with their activity (batch demo-showcase). A no-op when the batch already exists."
  task showcase: :environment do
    # Safe in production: needs no ALLOW_SYNTHETIC_QA, only touches the demo-* batch it names, and refuses
    # to grow the demo population past SyntheticQa::Demo::MAX_USERS. Remove it again from Admin -> Demo data.
    batch = ENV.fetch("BATCH", SyntheticQa::Demo::SHOWCASE_BATCH)
    outcome = SyntheticQa::Demo.with_admin_lock { SyntheticQa::Showcase.call(batch:) }
    abort "demo:showcase: another demo data job holds the lock; nothing was changed." if outcome == :locked

    warn "demo:showcase: no AWS_BUCKET, so the work samples link to ccMixter, which refuses cross-site playback; the audio will not play." unless SyntheticQa::TrackMirror.enabled?
    if outcome.skipped
      puts "demo:showcase: #{batch} already exists (#{User.synthetic(batch).count} accounts); nothing to do."
    else
      puts "demo:showcase: seeded #{outcome.batch}: #{outcome.to_h.except(:batch, :skipped).to_json}"
    end
    Rails.logger.info({ event: "demo_showcase.task", batch:, skipped: outcome.skipped }.to_json)
  end

  desc "Copy the forty demo CC BY tracks from ccMixter into the app's bucket (demo:showcase does this itself)."
  task mirror_tracks: :environment do
    abort "demo:mirror_tracks: no object storage is configured (AWS_BUCKET)." unless SyntheticQa::TrackMirror.enabled?

    tracks = SyntheticQa::ShowcaseContent.tracks
    copied = SyntheticQa::TrackMirror.mirror!(tracks)
    puts "demo:mirror_tracks: #{copied} copied, #{tracks.size - copied} already in the bucket."
  end
end
