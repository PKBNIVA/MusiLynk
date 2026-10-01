# Renders FounderReport data as the Monday email: { subject:, html:, text: }. Short plain copy,
# numbers in Indian grouping, dates in IST; the text version carries everything the HTML does.
class FounderReportMail
  def self.render(data, now: Time.current) = new(data, now).render

  def initialize(data, now)
    @data = data
    @now = now
    @current = data[:current]
    @previous = data[:previous]
    @waiting = data[:waiting]
    @links = data[:links]
  end

  def render
    sections = body_sections
    { subject:, html: html(sections), text: text(sections) }
  end

  private

  def label = @data[:week][:label]

  def subject
    return "Verse week #{label}: a quiet week" if @data[:quiet]

    signups = @current[:musicians] + @current[:hirers]
    "Verse week #{label}: #{n(signups)} #{'sign-up'.pluralize(signups)}, #{n(needs_you_total)} #{needs_you_total == 1 ? 'thing needs' : 'things need'} you"
  end

  def n(value) = IndianFormat.number(value)

  def needs_you_total = waiting_total

  def waiting_total
    @waiting_total ||= @waiting[:opportunities] + @waiting[:verification] + @data[:needsYou][:reportsTotal] + @data[:needsYou][:urgentTotal]
  end

  # --- Sections: [{ heading:, intro:, rows: [[label, value, note]], list: [...], link: [label, url] }] ---

  def body_sections
    sections = []
    sections << quiet_section if @data[:quiet]
    unless @data[:quiet]
      sections << people_section << opportunities_section << urgent_section << activity_section
    end
    sections << waiting_section unless @data[:quiet] && waiting_total.zero?
    sections << funnel_section unless @data[:quiet] && @data[:funnel][:steps].all? { _1[:count].zero? }
    sections << early_access_section
    sections << needs_you_section
    sections
  end

  def quiet_section
    last = @previous
    last_total = last[:musicians] + last[:hirers] + last[:opportunities] + last[:urgent] + last[:applications] + last[:enquiries] + last[:messages]
    before = last_total.zero? ? "The week before was quiet too." : "The week before had #{n(last[:musicians] + last[:hirers])} sign-ups and #{n(last[:opportunities])} opportunities."
    { heading: "A quiet week", intro: "No new sign-ups, opportunities, urgent requests, applications, enquiries or messages from real accounts in the week of #{label}. #{before} Anything waiting for you is below." }
  end

  def people_section
    { heading: "New people", rows: [
      row("New musicians", :musicians, "#{n(@current[:musiciansComplete])} finished their profile"),
      row("New hirers", :hirers, "#{n(@current[:hirersComplete])} finished their profile")
    ] }
  end

  def opportunities_section
    { heading: "Opportunities", rows: [
      row("Posted", :opportunities),
      row("Approved", :approved),
      ["Waiting for review", n(@waiting[:opportunities]), oldest_note]
    ] }
  end

  def oldest_note
    at = @waiting[:oldestOpportunityAt]
    at ? "oldest has waited #{age(at)}" : nil
  end

  def urgent_section
    posted = @current[:urgent]
    rows = [row("Posted", :urgent),
      ["Got a response", posted.zero? ? "0" : "#{n(@current[:urgentResponded])} of #{n(posted)}", change_note(@current[:urgentResponded], @previous[:urgentResponded])],
      ["Median time to first response", minutes(@current[:urgentMedianMinutes]) || "no responses yet", median_note],
      row("Filled", :urgentFilled)]
    { heading: "Urgent requests", rows: }
  end

  def median_note
    current = @current[:urgentMedianMinutes]
    last = @previous[:urgentMedianMinutes]
    return nil if current.nil? || last.nil?

    "last week #{minutes(last)}"
  end

  def activity_section
    { heading: "Activity", rows: [
      row("Applications sent", :applications),
      row("Booking enquiries", :enquiries),
      row("Quotes sent", :quotes),
      row("Bookings accepted", :bookingsAccepted),
      row("Bookings completed", :bookingsCompleted),
      row("Messages sent", :messages)
    ] }
  end

  def waiting_section
    needs = @data[:needsYou]
    { heading: "Waiting for a decision", rows: [
      ["Opportunities to review", n(@waiting[:opportunities]), nil],
      ["Verification requests", n(@waiting[:verification]), compare_note(@waiting[:verification], @waiting[:verificationWeekAgo], "a week ago")],
      ["Reports", n(@waiting[:reports]), compare_note(@waiting[:reports], @waiting[:reportsWeekAgo], "a week ago")],
      ["Urgent requests unanswered for 2 hours", n(needs[:urgentTotal]), nil]
    ] }
  end

  def funnel_section
    funnel = @data[:funnel]
    rows = funnel[:steps].each_with_index.map do |step, i|
      last = funnel[:previousSteps][i][:count]
      [funnel[:labels][step[:step]].to_s.sub(/\A./, &:upcase), n(step[:count]), compare_note(step[:count], last, "last week")]
    end
    { heading: "From visit to booking", rows:, intro: drop_off_sentence(funnel[:biggestDropOff], funnel[:steps]) }
  end

  def drop_off_sentence(drop, steps)
    return "No visits were recorded this week, so there is no drop-off to show." if steps.first[:count].zero?
    return "No step lost people this week." unless drop

    labels = @data[:funnel][:labels]
    "Biggest drop-off: of #{n(drop[:fromCount])} who #{labels[drop[:from]]}, #{n(drop[:toCount])} #{labels[drop[:to]]} (#{drop[:lostPercent]}% did not)."
  end

  def early_access_section
    ea = @data[:earlyAccess]
    { heading: "Early Access Pro", intro: "#{n(ea[:used])} of #{n(ea[:total])} seats used." }
  end

  def needs_you_section
    needs = @data[:needsYou]
    groups = [
      ["Opportunities waiting for review", needs[:opportunities], @waiting[:opportunities], @links[:opportunities]],
      ["Verification requests waiting", needs[:verification], @waiting[:verification], @links[:verification]],
      ["Open reports", needs[:reports], needs[:reportsTotal], @links[:reports]],
      ["Urgent requests with no response after 2 hours", needs[:urgent], needs[:urgentTotal], @links[:urgent]]
    ].map do |title, items, total, link|
      { title:, total:, link:, items: items.map { |i| "#{i[:text]}, waiting #{age(i[:since])}" }, more: [total - items.size, 0].max }
    end
    if groups.all? { _1[:total].zero? }
      { heading: "Needs you", intro: "Nothing is waiting for you." }
    else
      { heading: "Needs you", groups: }
    end
  end

  # --- Number helpers ---

  def row(title, key, extra = nil)
    [title, n(@current[key]), [change_note(@current[key], @previous[key]), extra].compact.join("; ")]
  end

  def change_note(current, last)
    return "same as last week" if current == last
    return "none last week" if last.zero?

    current > last ? "up #{n(current - last)} on last week" : "down #{n(last - current)} from last week"
  end

  def compare_note(current, last, when_text)
    current == last ? "same as #{when_text}" : "#{n(last)} #{when_text}"
  end

  def minutes(value)
    return nil if value.nil?

    total = value.round
    return "#{n(total)} min" if total < 60

    hours, mins = total.divmod(60)
    mins.zero? ? "#{n(hours)} h" : "#{n(hours)} h #{mins} min"
  end

  def age(time)
    seconds = (@now - time).to_i
    if seconds < 3600 then "#{[seconds / 60, 1].max} min"
    elsif seconds < 86_400 then hours = seconds / 3600; "#{hours} #{'hour'.pluralize(hours)}"
    else days = seconds / 86_400; "#{days} #{'day'.pluralize(days)}"
    end
  end

  # --- Plain text ---

  def text(sections)
    out = ["Verse weekly report", "Week of #{label} (Monday to Sunday, IST)", ""]
    sections.each do |s|
      out << s[:heading].upcase
      out << s[:intro] if s[:intro]
      Array(s[:rows]).each { |title, value, note| out << "- #{title}: #{value}#{" (#{note})" if note.present?}" }
      Array(s[:groups]).each do |g|
        next if g[:total].zero?

        out << "#{g[:title]} (#{n(g[:total])})"
        g[:items].each { out << "- #{_1}" }
        out << "  and #{n(g[:more])} more" if g[:more].positive?
        out << "  Open: #{g[:link]}"
      end
      out << ""
    end
    out << "Admin console: #{FounderReport.admin_url}"
    out.join("\n")
  end

  # --- HTML (single column, fluid tables, inline styles only) ---

  def html(sections)
    h = ERB::Util.method(:html_escape)
    body = sections.map { |s| section_html(s, h) }.join
    <<~HTML.squish
      <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0b0b12;color:#f8fafc;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:28px 16px">#{EmailDelivery.brand_header_html}<h1 style="font-size:22px;margin:24px 0 4px">Weekly report</h1><p style="color:#94a3b8;margin:0 0 8px;font-size:14px">#{h.call(label)} (Monday to Sunday, IST)</p>#{body}<p style="margin-top:28px;font-size:13px"><a href="#{h.call(FounderReport.admin_url)}" style="color:#a78bfa">Open the admin console</a></p></div></body></html>
    HTML
  end

  def section_html(section, h)
    parts = [%(<h2 style="font-size:16px;margin:24px 0 6px;color:#f8fafc">#{h.call(section[:heading])}</h2>)]
    parts << %(<p style="color:#cbd5e1;line-height:1.5;margin:6px 0">#{h.call(section[:intro])}</p>) if section[:intro]
    if section[:rows].present?
      rows = section[:rows].map do |title, value, note|
        note_html = note.present? ? %(<div style="color:#94a3b8;font-size:13px">#{h.call(note)}</div>) : ""
        %(<tr><td style="padding:8px 0;border-bottom:1px solid #1e293b;color:#cbd5e1;font-size:15px;vertical-align:top">#{h.call(title)}#{note_html}</td><td align="right" style="padding:8px 0 8px 12px;border-bottom:1px solid #1e293b;font-size:17px;font-weight:700;color:#f8fafc;vertical-align:top;white-space:nowrap">#{h.call(value)}</td></tr>)
      end.join
      parts << %(<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">#{rows}</table>)
    end
    Array(section[:groups]).each do |g|
      next if g[:total].zero?

      items = g[:items].map { |i| %(<li style="margin-bottom:6px">#{h.call(i)}</li>) }.join
      more = g[:more].positive? ? %(<li style="color:#94a3b8">and #{h.call(n(g[:more]))} more</li>) : ""
      parts << %(<h3 style="font-size:15px;margin:16px 0 4px;color:#e2e8f0">#{h.call(g[:title])} (#{h.call(n(g[:total]))})</h3><ul style="padding-left:18px;margin:4px 0;color:#cbd5e1;line-height:1.45">#{items}#{more}</ul>#{EmailDelivery.button_html('Open in the admin console', g[:link]).sub('margin-top:18px', 'margin-top:8px')}) 
    end
    parts.join
  end
end
