# Dates and times as people in India read them, for emails, notifications and WhatsApp:
# "5 Oct 2026" and "9 Oct, 6:30 pm", always in IST, never "05 Oct 2026" or "06:30 PM".
# The frontend counterpart is src/app/lib/format.ts (formatDate / formatWhen).
module IndianFormat
  ZONE = "Asia/Kolkata".freeze

  # "5 Oct 2026"; nil for nil.
  def self.date(time)
    time&.in_time_zone(ZONE)&.strftime("%-d %b %Y")
  end

  # "9 Oct, 6:30 pm" (the minutes are dropped on the hour: "9 Oct, 6 pm"); nil for nil.
  def self.date_time(time)
    time&.in_time_zone(ZONE)&.strftime("%-d %b, %-l:%M %P")&.sub(":00", "")
  end

  # Same as .date_time for an ISO 8601 string (what a template receives in its params).
  def self.date_time_from_iso(value)
    date_time(Time.zone.parse(value.to_s)) if value.present?
  rescue ArgumentError
    nil
  end
end
