# Writes the real ids the UX sweep substitutes into route params. Usage (from backend/):
#   bin/rails runner ../tests/e2e/support/ux-sweep/ids.rb /home/user/ux-stack/ids.json
b = User.find_by!(email: "qa+demo-showcase-professional-0001@example.invalid")
d = User.find_by!(email: "qa+demo-showcase-employer-0007@example.invalid")
demo = User.synthetic("demo-showcase").where(role: "jobseeker").order(:email).offset(2).first
act = Act.where(owner_id: b.id).first
live = Job.where(employer_id: d.id, status: "published").first
post = Post.where(author_type: "user", author_id: b.id).first || Post.first
tag = Post.pluck(:hashtags).flatten.tally.max_by { |_, n| n }&.first
conv = Conversation.where(candidate_id: b.id, employer_id: d.id).first
inv = Invoice.joins("JOIN booking_payments bp ON bp.id = invoices.booking_payment_id").where("bp.payer_id = ?", d.id).first
posted = Job.where.not(posted_as_type: nil).first
ids = {
  accounts: { newMusician: "ux.new.musician@verse.local", musician: b.email, newHirer: "ux.new.hirer@verse.local", hirer: d.email, admin: "admin@verse.local" },
  musicianId: b.id, demoMusicianId: demo.id, hirerId: d.id, actId: act&.id, jobId: live&.id, otherJobId: Job.where(status: "published").where.not(employer_id: d.id).first&.id,
  conversationId: conv&.id, portfolioSlug: Portfolio.where(owner_id: b.id).first&.slug, portfolioId: Portfolio.where(owner_id: b.id).first&.id, postId: post&.id, postAuthorType: post&.author_type, postAuthorId: post&.author_id,
  tag: tag, invoiceId: inv&.id, urgentId: UrgentRequest.where(requester_id: d.id, status: "open").first&.id,
  pagesType: (posted ? posted.posted_as_type : "act"), pagesId: (posted ? posted.posted_as_id : act&.id), bookingId: BookingRequest.where(requester_id: d.id).first&.id
}
File.write(ARGV[0] || "ids.json", JSON.pretty_generate(ids))
puts JSON.pretty_generate(ids)
