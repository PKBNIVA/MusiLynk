# Helpers for the Pages, portfolios and resumes suites.
module ShowcaseHelpers
  PASSWORD = "Harbor-Lantern-4827!".freeze

  def make_user(name, role = "jobseeker", profile: nil, complete: true)
    user = User.create!(name:, email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.com", password: PASSWORD, role:,
      status: "active", profile_complete: complete, email_verified: true)
    user.create_profile!(profile) if profile
    user
  end

  def auth(user, as: nil)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    headers = { "Authorization" => "Bearer #{raw}" }
    headers[ActingAs::HEADER] = as if as
    headers
  end

  def make_org(owner, name = "Riya Studios", status: "active")
    org = Organization.create!(owner:, name:, status:)
    org.organization_members.create!(user: owner, role: "owner")
    org
  end

  def make_act(owner, name = "The Night Shift", status: "active")
    Act.create!(owner:, name:, act_type: "band", currency: "INR", fee_basis: "event", status:)
  end

  def make_item(user, title = "Live take", **attrs)
    PortfolioItem.create!({ user:, kind: "audio", title:, url: "https://example.com/#{SecureRandom.hex(3)}.mp3", visibility: "public" }.merge(attrs))
  end

  def make_pdf(user, status: "complete", content_type: "application/pdf")
    Upload.create!(user:, storage: "disk", key: "resume-#{SecureRandom.hex(4)}", filename: "cv.pdf", content_type:, byte_size: 100,
      status:, public_url: "https://example.com/uploads/#{SecureRandom.hex(4)}.pdf")
  end

  def published_job(employer, **attrs)
    Job.create!({ employer:, title: "Session drummer", company: "Studio", location: "Pune", kind: "Contract", genre: "Rock",
      description: "A properly documented professional opportunity with clear responsibilities and written terms.",
      status: "published", published_at: Time.current }.merge(attrs))
  end

  def json = response.parsed_body

  # Swaps in a real cache so per-user rate limits count (the test env uses :null_store).
  def with_counting_cache
    original = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    yield
  ensure
    Rails.cache = original
  end
end
