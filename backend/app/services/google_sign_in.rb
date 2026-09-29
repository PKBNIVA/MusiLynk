# Applies the Google sign-in merge rules (see GoogleAuthController) to a verified Google ID
# token's claims. Returns a Result; never raises for an expected outcome (see ERROR_CODES),
# only for a genuine bug.
class GoogleSignIn
  ERROR_CODES = %w[email_unverified connected_elsewhere disabled].freeze

  Result = Data.define(:user, :created, :notify_linked, :error) do
    def ok? = error.nil?
  end

  # intent: "signin" | "connect". role: required for a brand-new signin user. owner_user:
  # the signed-in user, for intent=connect. consent: the sign-up consent checkbox.
  def self.call(claims:, intent:, role: nil, owner_user: nil, consent: false)
    new(claims:, intent:, role:, owner_user:, consent:).call
  end

  def initialize(claims:, intent:, role:, owner_user:, consent:)
    @claims = claims
    @intent = intent
    @role = role
    @owner_user = owner_user
    @consent = consent
  end

  def call
    return connect! if @intent == "connect"
    signin!
  end

  private

  def uid = @claims["sub"]
  def email = @claims["email"].to_s.strip.downcase
  def email_verified? = ActiveModel::Type::Boolean.new.cast(@claims["email_verified"])
  def name = @claims["name"].presence || email.split("@").first
  def avatar_url = @claims["picture"]

  def connect!
    return Result.new(user: nil, created: false, notify_linked: false, error: "email_unverified") unless email_verified?

    existing = AuthConnection.google.find_by(provider_uid: uid)
    if existing && existing.owner_id != @owner_user.id
      return Result.new(user: nil, created: false, notify_linked: false, error: "connected_elsewhere")
    end

    connection = existing || AuthConnection.new(owner: @owner_user, provider: "google", provider_uid: uid)
    apply_claims!(connection)
    Result.new(user: @owner_user, created: false, notify_linked: false, error: nil)
  end

  def signin!
    return Result.new(user: nil, created: false, notify_linked: false, error: "email_unverified") unless email_verified?

    connection = AuthConnection.google.find_by(provider_uid: uid)
    if connection
      apply_claims!(connection)
      return Result.new(user: connection.owner, created: false, notify_linked: false, error: nil)
    end

    user = User.find_by(email:)
    if user
      connection = AuthConnection.new(owner: user, provider: "google", provider_uid: uid)
      apply_claims!(connection)
      user.update!(email_verified: true) unless user.email_verified?
      return Result.new(user:, created: false, notify_linked: true, error: nil)
    end

    create_user!
  end

  def create_user!
    return Result.new(user: nil, created: false, notify_linked: false, error: "role_required") if @role.blank?

    user = User.transaction do
      created = User.create!(name:, email:, role: @role, status: :active, email_verified: true,
        password: SecureRandom.base58(32), consented_at: @consent ? Time.current : nil)
      created.create_profile!
      created
    end
    connection = AuthConnection.new(owner: user, provider: "google", provider_uid: uid)
    apply_claims!(connection)
    Result.new(user:, created: true, notify_linked: false, error: nil)
  end

  def apply_claims!(connection)
    connection.email = email
    connection.email_verified = true
    connection.display_name = name
    connection.avatar_url = avatar_url
    connection.raw = @claims.except("sub")
    connection.last_synced_at = Time.current
    connection.save!
  end
end
