namespace :reports do
  desc "Weekly founder report for the last full Monday-Sunday (IST). `reports:founder[preview]` prints the plain-text version; " \
       "`reports:founder` sends it now to FOUNDER_REPORT_TO (or the active admins)."
  task :founder, [:mode] => :environment do |_task, args|
    now = Time.current
    content = FounderReportMail.render(FounderReport.new(now:).call, now:)
    if args[:mode].to_s == "preview"
      puts "Subject: #{content[:subject]}", "", content[:text]
    else
      recipients = FounderReport.recipients
      abort "reports:founder: no recipients. Set FOUNDER_REPORT_TO or have an active admin user." if recipients.empty?
      recipients.each { |to| FounderReportDeliveryJob.perform_now(to, content[:subject], content[:html], content[:text]) }
      puts "reports:founder: sent to #{recipients.size} recipient(s)."
    end
  end
end
