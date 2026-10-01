# Creates the five named UX-sweep accounts. Idempotent. Run: bin/rails runner /home/user/ux-stack/accounts.rb
PASSWORD = "UxSweepPass123!"
def make_user(email, name, role, complete: false)
  u = User.find_or_initialize_by(email: email)
  u.assign_attributes(name:, role:, status: "active", email_verified: true, profile_complete: complete, password: PASSWORD, skip_password_strength: true, consented_at: Time.current)
  u.save!
  u.create_profile! unless u.profile
  u
end

# (a) brand-new musician, empty profile; (c) brand-new hirer, nothing
a = make_user("ux.new.musician@verse.local", "Nina Newcomer", "jobseeker")
c = make_user("ux.new.hirer@verse.local", "Harsh Newhirer", "employer")

# (b) populated musician: showcase professional 0001 gets a known password
b = User.find_by!(email: "qa+demo-showcase-professional-0001@example.invalid")
b.update!(password: PASSWORD, skip_password_strength: true, email_verified: true, status: "active", profile_complete: true)
# (d) populated hirer: showcase employer 0007
d = User.find_by!(email: "qa+demo-showcase-employer-0007@example.invalid")
d.update!(password: PASSWORD, skip_password_strength: true, email_verified: true, status: "active", profile_complete: true)

# --- extra data so every state exists -------------------------------------------------------
act = Act.where(owner_id: b.id).first!
hirers = User.synthetic("demo-showcase").where(role: "employer").where.not(id: d.id).limit(4).to_a
now = Time.current
statuses = %w[requested viewed negotiating quoted accepted declined cancelled disputed]
statuses.each_with_index do |st, i|
  requester = i.even? ? d : hirers[i % hirers.size]
  next if BookingRequest.where(act_id: act.id, requester_id: requester.id, event_name: "UX sweep #{st}").exists?
  br = BookingRequest.create!(act: act, requester: requester, event_type: %w[Wedding Corporate Private\ party Concert][i % 4], city: %w[Mumbai Pune Delhi][i % 3], currency: "INR", status: "requested",
    event_name: "UX sweep #{st}", event_date: (now + (10 + i * 6).days).to_date, start_time: "19:30", venue_name: "The Grand Hall #{i + 1}", venue_address: "Linking Road, Bandra",
    indoor_outdoor: "indoor", duration_minutes: 120, audience_size: 150 + i * 20, budget_min: 40_000, budget_max: 90_000, requirements: "Two sets, sound provided.")
  if %w[quoted accepted disputed].include?(st)
    BookingQuote.create!(booking_request: br, created_by: b, performance_fee: 60_000, travel_fee: 5_000, production_fee: 3_000, other_fee: 0, currency: "INR", status: st == "quoted" ? "sent" : "accepted", deposit_percent: 50, valid_until: now + 5.days, inclusions: "2 x 45 min sets", exclusions: "Backline", cancellation_terms: "Deposit non-refundable inside 7 days")
  end
  br.update_columns(status: st, updated_at: now - i.hours)
end

# Live opportunities + other states for the hirer, with applicants incl. the populated musician
live = Job.where(employer_id: d.id, status: "published").first
others = User.synthetic("demo-showcase").where(role: "jobseeker").where.not(id: b.id).limit(6).to_a
if live
  ([b] + others).each_with_index do |cand, i|
    next if Application.exists?(job_id: live.id, candidate_id: cand.id)
    Application.create!(job: live, candidate: cand, cover_letter: "Available on the dates and keen to play. Reel attached.", status: ["Applied", "Under Review", "Shortlisted", "Interview Scheduled", "Offer", "Rejected", "Hired"][i % 7])
  end
  { "draft" => "Draft: Corporate Diwali night", "pending" => "Pending review: Acoustic duo for cafe", "closed" => "Closed: Studio keys session" }.each do |st, title|
    next if Job.exists?(employer_id: d.id, title: title)
    j = live.dup
    j.assign_attributes(title: title, status: st, published_at: st == "draft" ? nil : now - 20.days)
    j.save!
  end
end

# Subscription (hirer on Pro), notifications, one conversation with messages
Subscription.find_or_create_by!(user_id: d.id) { |s| s.assign_attributes(plan_code: "pro", provider: "internal", status: "active", interval: "monthly", current_period_start: now - 10.days, current_period_end: now + 20.days) }
conv = Conversation.find_or_create_by!(candidate_id: b.id, employer_id: d.id, job_id: live&.id)
if conv.messages.count < 4
  [[d, "Hi! Loved your reel. Are you free on the 14th?"], [b, "Yes, the evening is open. What is the venue?"], [d, "A hall in Bandra, 7:30 pm start."], [b, "Perfect. Sending a quote today."]].each_with_index do |(who, body), i|
    Message.create!(conversation: conv, sender: who, body: body, read_at: (i < 2 ? now : nil), created_at: now - (4 - i).hours)
  end
end
[[b, "booking", "New booking enquiry", "/jobseeker/bookings", "UX sweep requested wants to book your act."],
 [b, "application_status", "Application update", "/jobseeker/applications", "Your application moved to Shortlisted."],
 [b, "message", "New message", "/jobseeker/messages", "Harsh: Perfect. Sending a quote today."],
 [b, "urgent", "Urgent request in Mumbai", "/jobseeker/urgent", "A hirer needs a keyboardist tomorrow."],
 [d, "application", "New application", "/employer/applications", "A musician applied to your opportunity."],
 [d, "booking_quote", "Booking quote received", "/employer/bookings", "You have a new quote."],
 [d, "urgent_response", "Availability response", "/employer/urgent", "A musician responded to your urgent request."]].each_with_index do |(u, kind, title, link, body), i|
  next if Notification.exists?(user_id: u.id, title:, body:)
  Notification.create!(user: u, kind:, title:, link:, body:, read_at: (i.odd? ? nil : now - 1.hour), created_at: now - i.hours)
end
puts({ a: a.email, b: b.email, c: c.email, d: d.email, bookings_on_act: BookingRequest.where(act_id: act.id).group(:status).count, d_jobs: Job.where(employer_id: d.id).group(:status).count, d_urgent: UrgentRequest.where(requester_id: d.id).group(:status).count, d_apps: Application.where(job_id: Job.where(employer_id: d.id)).count, act: act.id, live_job: live&.id }.to_json)

# Open urgent request with responses for the populated hirer
d = User.find_by!(email: "qa+demo-showcase-employer-0007@example.invalid")
unless UrgentRequest.exists?(requester_id: d.id, status: "open")
  t = Time.current
  ur = UrgentRequest.create!(requester: d, title: "Keyboardist needed tomorrow evening", role_name: "Keyboard player", city: "Mumbai", currency: "INR", status: "open", instrument: "Keyboard", genre: "Bollywood",
    start_at: (t + 1.day).change(hour: 19), end_at: (t + 1.day).change(hour: 22), budget_min: 8000, budget_max: 15000, requirements: "Cover set, own keys, sound provided.", travel_covered: true, expires_at: t + 20.hours)
  User.synthetic("demo-showcase").where(role: "jobseeker").limit(3).each_with_index do |u, i|
    UrgentRequestResponse.create!(urgent_request: ur, user: u, message: ["Free tomorrow, can do.", "Available, bringing my own Nord.", "Can be there by 5 pm."][i], rate: 9000 + i * 2000, status: "available", created_at: t - (i * 20 + 5).minutes, updated_at: t)
  end
end
puts "urgent: #{UrgentRequest.where(requester_id: d.id).group(:status).count} responses=#{UrgentRequestResponse.where(urgent_request_id: UrgentRequest.where(requester_id: d.id, status: 'open').select(:id)).count}"
