namespace :lifecycle do
  desc "Delete lifecycle_emails rows claimed while no email could be delivered, so those steps can send again. " \
       "SINCE=<ISO time> (required: when delivery was last known to be broken), KEYS=a,b (optional: only these " \
       "lifecycle_email_skipped log keys), DRY_RUN=1 to only count."
  task release_undelivered: :environment do
    since = ENV["SINCE"].presence or abort "SINCE is required, e.g. SINCE=2026-09-29T00:00:00Z"
    time = Time.zone.parse(since) or abort "SINCE is not a time: #{since}"
    rows = LifecycleEmail.where(sent_at: time..)
    rows = rows.where(key: ENV["KEYS"].split(",").map(&:strip)) if ENV["KEYS"].present?
    rows = rows.where.not("key LIKE ?", "digest:%")
    count = ENV["DRY_RUN"] == "1" ? rows.count : rows.delete_all
    puts "#{ENV['DRY_RUN'] == '1' ? 'Would release' : 'Released'} #{count} lifecycle email row(s) claimed since #{time.iso8601}."
  end
end
