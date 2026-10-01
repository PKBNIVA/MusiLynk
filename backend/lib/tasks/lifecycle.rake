namespace :lifecycle do
  desc "Delete every non-digest lifecycle_emails row claimed at or after SINCE whose delivered_at is still empty " \
       "(LifecycleEmailDeliveryJob stamps delivered_at when the provider accepts a message), so those steps can send " \
       "again. Rows claimed before the column existed have no delivered_at and are treated as undelivered, so use PAIRS " \
       "for those. " \
       "SINCE=<ISO time> (required: when delivery was last known to be broken), KEYS=a,b (optional: only these " \
       "lifecycle_email_skipped log keys), PAIRS=userId:key,userId:key (optional: only these exact rows, copied from the " \
       "lifecycle_email_skipped log lines, so users who did get the email are not re-sent), DRY_RUN=1 to only count."
  task release_undelivered: :environment do
    since = ENV["SINCE"].presence or abort "SINCE is required, e.g. SINCE=2026-09-29T00:00:00Z"
    time = Time.zone.parse(since) or abort "SINCE is not a time: #{since}"
    rows = LifecycleEmail.where(sent_at: time.., delivered_at: nil)
    rows = rows.where(key: ENV["KEYS"].split(",").map(&:strip)) if ENV["KEYS"].present?
    if ENV["PAIRS"].present?
      pairs = ENV["PAIRS"].split(",").map { |pair| pair.strip.split(":", 2) }
      abort "PAIRS must look like userId:key,userId:key" if pairs.any? { |user_id, key| user_id.blank? || key.blank? }
      rows = pairs.map { |user_id, key| rows.where(user_id: user_id, key: key) }.reduce(:or)
    end
    rows = rows.where.not("key LIKE ?", "digest:%")
    count = ENV["DRY_RUN"] == "1" ? rows.count : rows.delete_all
    puts "#{ENV['DRY_RUN'] == '1' ? 'Would release' : 'Released'} #{count} lifecycle email row(s) claimed since #{time.iso8601}."
  end
end
