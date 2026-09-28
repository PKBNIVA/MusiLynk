namespace :backfill do
  desc "Give every pre-existing message notification a link (idempotent; safe to re-run)"
  task message_notification_links: :environment do
    fixed = MessageNotificationLinkBackfill.run!
    puts "Backfilled #{fixed} message notification link(s)."
  end
end
