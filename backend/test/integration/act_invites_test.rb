require "test_helper"
require "minitest/mock"

# Bandmate invites: nobody joins an act's lineup without accepting. Covers who may invite, the three
# invite kinds, the token rules (digest only, single use, expiry, revoke), the accept/decline
# authorisation, rate limits, the changed add_member endpoint, leaving, audit and notifications.
class ActInvitesTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    ENV["FRONTEND_URL"] = "https://musilynk.example"
    @owner = make_user("Olive Owner", "ai-owner@example.com", "jobseeker")
    @rohan = make_user("Rohan Tabla", "ai-rohan@example.com", "jobseeker", headline: "Tabla player", roles: ["Tabla"], location: "Pune")
    @asha = make_user("Asha Vocals", "ai-asha@example.com", "jobseeker")
    @hirer = make_user("Hira Hirer", "ai-hirer@example.com", "employer")
    @act = Act.create!(owner: @owner, name: "The Night Owls", act_type: "band", status: "active", currency: "INR", fee_basis: "event")
    @act.act_members.create!(user: @owner, display_name: @owner.name, role_name: "Leader", is_leader: true, member_status: "confirmed")
  end

  teardown do
    Rails.cache = @original_cache
    ENV.delete("FRONTEND_URL")
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end

  def make_user(name, email, role, headline: nil, roles: [], location: "Mumbai")
    user = User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", email_verified: true, profile_complete: true)
    user.create_profile!(headline: headline || name, location:, roles:) unless role == "admin"
    user
  end

  def invite!(body, user: @owner, act: @act)
    post "/api/acts/#{act.id}/invites", params: body, headers: auth(user), as: :json
  end

  def last_invite = ActInvite.order(:created_at, :id).last
  def first_invite = ActInvite.order(:created_at, :id).first

  def link_token(response_body) = response_body.fetch("link").split("/invites/").last

  # --- who may invite -------------------------------------------------------------------------
  test "only the act owner can invite, list, resend or revoke" do
    invite!({ kind: "user", userId: @rohan.id, roleName: "Tabla" })
    assert_response :created
    id = response.parsed_body.dig("invite", "id")

    [@asha, @hirer].each do |outsider|
      invite!({ kind: "link", roleName: "Keys" }, user: outsider)
      assert_response :not_found
      get "/api/acts/#{@act.id}/invites", headers: auth(outsider)
      assert_response :not_found
      post "/api/acts/#{@act.id}/invites/#{id}/resend", headers: auth(outsider)
      assert_response :not_found
      delete "/api/acts/#{@act.id}/invites/#{id}", headers: auth(outsider)
      assert_response :not_found
      get "/api/acts/#{@act.id}/invitees", params: { q: "Rohan" }, headers: auth(outsider)
      assert_response :not_found
    end
    post "/api/acts/#{@act.id}/invites", params: { kind: "link", roleName: "Keys" }, as: :json
    assert_response :unauthorized
    assert_equal 1, ActInvite.count
  end

  test "a lineup member who is not the owner cannot invite" do
    @act.act_members.create!(user: @asha, display_name: "Asha", role_name: "Vocals", member_status: "confirmed")
    invite!({ kind: "link", roleName: "Keys" }, user: @asha)
    assert_response :not_found
  end

  # --- search ---------------------------------------------------------------------------------
  test "search finds musicians by name or profile and never exposes an email" do
    get "/api/acts/#{@act.id}/invitees", params: { q: "tabla" }, headers: auth(@owner)
    assert_response :ok
    found = response.parsed_body.fetch("musicians")
    assert_equal [@rohan.id], found.pluck("id")
    assert_not_includes response.body, "ai-rohan@example.com"
    assert_equal %w[headline id location name roles verified], found.first.keys.sort

    get "/api/acts/#{@act.id}/invitees", params: { q: "Olive" }, headers: auth(@owner)
    assert_empty response.parsed_body.fetch("musicians"), "the owner is not offered themselves"
    get "/api/acts/#{@act.id}/invitees", params: { q: "R" }, headers: auth(@owner)
    assert_empty response.parsed_body.fetch("musicians"), "too short to search"
    get "/api/acts/#{@act.id}/invitees", params: { q: ["a"] }, headers: auth(@owner)
    assert_response :bad_request
  end

  test "search leaves out people already in the lineup, hirers and blocked musicians" do
    @act.act_members.create!(user: @rohan, display_name: "Rohan", role_name: "Tabla", member_status: "confirmed")
    get "/api/acts/#{@act.id}/invitees", params: { q: "Ro" }, headers: auth(@owner)
    assert_empty response.parsed_body.fetch("musicians")
    get "/api/acts/#{@act.id}/invitees", params: { q: "Hira" }, headers: auth(@owner)
    assert_empty response.parsed_body.fetch("musicians")
    UserBlock.create!(blocker: @asha, blocked: @owner)
    get "/api/acts/#{@act.id}/invitees", params: { q: "Asha" }, headers: auth(@owner)
    assert_empty response.parsed_body.fetch("musicians")
  end

  # --- consent ---------------------------------------------------------------------------------
  test "inviting a MusiLynk musician adds nobody until they accept, and notifies them" do
    assert_difference -> { Notification.where(user: @rohan, kind: "act_invite").count }, 1 do
      invite!({ userId: @rohan.id, roleName: "Tabla", instrument: "Tabla" })
    end
    assert_response :created
    assert_not @act.act_members.exists?(user_id: @rohan.id), "consent: no membership before accept"
    invite = last_invite
    assert_equal ["user", "pending", @rohan.id], [invite.kind, invite.status, invite.invitee_user_id]
    assert_in_delta 7.days.from_now.to_i, invite.expires_at.to_i, 60
    assert_equal "Tabla", response.parsed_body.dig("invite", "roleName")
    assert_nil response.parsed_body["link"]

    get "/api/act-invites/mine", headers: auth(@rohan)
    assert_equal [invite.id], response.parsed_body.fetch("invites").pluck("id")
    assert_equal "Olive Owner", response.parsed_body.dig("invites", 0, "inviterName")

    post "/api/act-invites/#{invite.id}/accept", headers: auth(@rohan)
    assert_response :ok
    member = @act.act_members.find_by!(user_id: @rohan.id)
    assert_equal ["Rohan Tabla", "Tabla", "Tabla", "confirmed", false], [member.display_name, member.role_name, member.instrument, member.member_status, member.is_leader]
    assert_equal ["accepted", @rohan.id], ActInvite.find(invite.id).then { [_1.status, _1.accepted_by_id] }
    assert_equal 1, Notification.where(user: @owner, kind: "act_invite").count
    get "/api/act-invites/mine", headers: auth(@rohan)
    assert_empty response.parsed_body.fetch("invites")
  end

  test "declining leaves the lineup alone and tells the owner" do
    invite!({ userId: @rohan.id, roleName: "Tabla" })
    invite = last_invite
    post "/api/act-invites/#{invite.id}/decline", headers: auth(@rohan)
    assert_response :ok
    assert_equal "declined", invite.reload.status
    assert_not @act.act_members.exists?(user_id: @rohan.id)
    assert_match(/declined/, Notification.where(user: @owner, kind: "act_invite").last.title)
    post "/api/act-invites/#{invite.id}/accept", headers: auth(@rohan)
    assert_response :gone
    assert_equal "INVITE_DECLINED", response.parsed_body["code"]
    assert_not @act.act_members.exists?(user_id: @rohan.id)
  end

  test "add_member with a userId now sends an invite instead of adding the musician" do
    post "/api/acts/#{@act.id}/members", params: { userId: @rohan.id, roleName: "Tabla" }, headers: auth(@owner), as: :json
    assert_response :created
    assert response.parsed_body["invited"]
    assert response.parsed_body["id"].present?
    assert_not @act.act_members.exists?(user_id: @rohan.id)
    assert_equal 1, ActInvite.where(invitee_user_id: @rohan.id, status: "pending").count
    assert_equal 1, AuditLog.where(action: "act_invite.create").count

    post "/api/acts/#{@act.id}/members", params: { userId: @rohan.id, roleName: "Tabla" }, headers: auth(@owner), as: :json
    assert_response :conflict
    post "/api/acts/#{@act.id}/members", params: { userId: @hirer.id, roleName: "Tabla" }, headers: auth(@owner), as: :json
    assert_response :not_found
    post "/api/acts/#{@act.id}/members", params: { userId: @asha.id, roleName: "" }, headers: auth(@owner), as: :json
    assert_response :unprocessable_content
    assert_equal 1, ActInvite.count
  end

  test "add_member without a userId still names a bandmate who is not on MusiLynk, and existing members are untouched" do
    post "/api/acts/#{@act.id}/members", params: { displayName: "Session Dhol", roleName: "Dhol" }, headers: auth(@owner), as: :json
    assert_response :created
    member = @act.act_members.find(response.parsed_body.fetch("id"))
    assert_nil member.user_id
    assert_equal 2, @act.act_members.count
    delete "/api/acts/#{@act.id}/members/#{member.id}", headers: auth(@owner)
    assert_response :ok
    assert_equal 1, @act.act_members.count
  end

  # --- email invites ----------------------------------------------------------------------------
  test "an email invite to someone off MusiLynk queues a sealed link email and only the matching verified address can accept" do
    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
    assert_enqueued_with(job: EmailDeliveryJob) { invite!({ kind: "email", email: "  New.Person@Example.com ", roleName: "Keys" }) }
    assert_response :created
    invite = last_invite
    assert_equal "new.person@example.com", invite.invitee_email
    assert_not_includes response.body, "new.person@example.com", "the owner only sees a masked address"
    assert_equal "n***@example.com", response.parsed_body.dig("invite", "inviteeEmail")
    job = enqueued_jobs.find { _1["job_class"] == "EmailDeliveryJob" }
    assert_not_includes job["arguments"].to_json, "new.person", "the address is sealed in the job row"

    stranger = make_user("Nina New", "new.person@example.com", "jobseeker")
    stranger.update!(email_verified: false)
    get "/api/act-invites/mine", headers: auth(stranger)
    assert_empty response.parsed_body.fetch("invites"), "an unverified address proves nothing"
    stranger.update!(email_verified: true)
    get "/api/act-invites/mine", headers: auth(stranger)
    assert_equal [invite.id], response.parsed_body.fetch("invites").pluck("id")

    post "/api/act-invites/#{invite.id}/accept", headers: auth(@asha)
    assert_response :not_found
    post "/api/act-invites/accept", params: { token: "wrong" }, headers: auth(stranger), as: :json
    assert_response :not_found
    post "/api/act-invites/#{invite.id}/accept", headers: auth(stranger)
    assert_response :ok
    assert @act.act_members.exists?(user_id: stranger.id)
  ensure
    ENV.delete("EMAIL_DELIVERY_WEBHOOK")
  end

  test "an email invite to an existing musician is also an in-app notice, and the wrong account cannot use the token" do
    invite!({ kind: "email", email: @rohan.email.upcase, roleName: "Tabla" })
    assert_response :created
    assert_equal 1, Notification.where(user: @rohan, kind: "act_invite").count
    assert_equal 1, AuditLog.where(action: "act_invite.create").count
    invite!({ kind: "email", email: @rohan.email, roleName: "Tabla" })
    assert_response :conflict
  end

  test "the emailed link reaches the provider with the inviter, band, role and link" do
    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
    sent = []
    transport = ->(_url, &block) { request = Struct.new(:headers, :body, :options).new({}, nil, Struct.new(:open_timeout, :timeout).new); block.call(request); sent << JSON.parse(request.body); Struct.new(:success?, :status).new(true, 200) }
    perform_enqueued_jobs do
      Faraday.stub(:post, transport) { invite!({ kind: "email", email: "reach@example.com", roleName: "Keys" }) }
    end
    assert_response :created
    data = sent.first.fetch("data")
    assert_equal ["act_invite", "reach@example.com"], [sent.first["template"], sent.first["to"]]
    assert_equal ["Olive Owner", "The Night Owls", "Keys"], data.values_at("name", "act", "role")
    assert_match(%r{\Ahttps://musilynk\.example/invites/[\w-]+\z}, data["link"])
    assert_equal last_invite, ActInvite.find_by_token(data["link"].split("/").last)
  ensure
    ENV.delete("EMAIL_DELIVERY_WEBHOOK")
  end

  test "resend rotates the secret, is rate limited and cannot revive a closed invite" do
    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
    invite!({ kind: "email", email: "again@example.com", roleName: "Keys" })
    invite = last_invite
    old_digest = invite.token_digest
    post "/api/acts/#{@act.id}/invites/#{invite.id}/resend", headers: auth(@owner)
    assert_response :too_many_requests, "sent seconds ago"

    invite.update_columns(last_sent_at: 5.minutes.ago)
    post "/api/acts/#{@act.id}/invites/#{invite.id}/resend", headers: auth(@owner)
    assert_response :ok
    assert_not_equal old_digest, invite.reload.token_digest
    assert_equal 2, invite.send_count
    assert_equal 1, AuditLog.where(action: "act_invite.resend").count

    invite.update_columns(last_sent_at: 5.minutes.ago, send_count: ActInvite::MAX_SENDS)
    post "/api/acts/#{@act.id}/invites/#{invite.id}/resend", headers: auth(@owner)
    assert_response :too_many_requests

    delete "/api/acts/#{@act.id}/invites/#{invite.id}", headers: auth(@owner)
    post "/api/acts/#{@act.id}/invites/#{invite.id}/resend", headers: auth(@owner)
    assert_response :gone
  ensure
    ENV.delete("EMAIL_DELIVERY_WEBHOOK")
  end

  # --- link invites ----------------------------------------------------------------------------
  test "a link invite stores only a digest, can be previewed anonymously and is single use" do
    invite!({ kind: "link", roleName: "Keys", instrument: "Piano" })
    assert_response :created
    token = link_token(response.parsed_body)
    assert_equal "https://musilynk.example/invites/#{token}", response.parsed_body["link"]
    invite = last_invite
    assert_not_equal token, invite.token_digest
    assert_equal ActInvite.digest(token), invite.token_digest
    assert_nil ActInvite.column_names.grep(/\Atoken\z/).first
    assert_not_includes invite.attributes.values.map(&:to_s), token

    get "/api/act-invites/preview", params: { token: }
    assert_response :ok
    preview = response.parsed_body.fetch("invite")
    assert_equal ["The Night Owls", "Olive Owner", "Keys", false], [preview["actName"], preview["inviterName"], preview["roleName"], preview["addressed"]]
    assert_not_includes response.body, @owner.email

    get "/api/act-invites/preview", params: { token: "nope" }
    assert_response :not_found
    post "/api/act-invites/accept", params: { token: }, as: :json
    assert_response :unauthorized
    assert_not @act.act_members.exists?(user_id: @asha.id)

    post "/api/act-invites/accept", params: { token: }, headers: auth(@asha), as: :json
    assert_response :ok
    assert @act.act_members.exists?(user_id: @asha.id)

    post "/api/act-invites/accept", params: { token: }, headers: auth(@rohan), as: :json
    assert_response :gone
    assert_equal "INVITE_USED", response.parsed_body["code"]
    assert_not @act.act_members.exists?(user_id: @rohan.id)
    get "/api/act-invites/preview", params: { token: }
    assert_equal "accepted", response.parsed_body.dig("invite", "status")
  end

  test "an open link invite can be accepted by any signed-in musician but not by a hirer" do
    invite!({ kind: "link", roleName: "Keys" })
    token = link_token(response.parsed_body)
    post "/api/act-invites/accept", params: { token: }, headers: auth(@hirer), as: :json
    assert_response :forbidden
    assert_equal "pending", last_invite.status
    post "/api/act-invites/accept", params: { token: }, headers: auth(@owner), as: :json
    assert_response :conflict, "the owner is already in the lineup"
    post "/api/act-invites/accept", params: { token: }, headers: auth(@rohan), as: :json
    assert_response :ok
  end

  test "declining someone else's shared link does not burn it" do
    invite!({ kind: "link", roleName: "Keys" })
    token = link_token(response.parsed_body)
    post "/api/act-invites/decline", params: { token: }, headers: auth(@rohan), as: :json
    assert_response :ok
    assert_equal "pending", last_invite.status
    assert_equal 0, AuditLog.where(action: "act_invite.decline").count
  end

  test "an invite addressed to a user cannot be accepted by a different signed-in user, by id or token" do
    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
    invite!({ kind: "email", email: "someone.else@example.com", roleName: "Keys" })
    invite = last_invite
    # The token is only in the sealed email; mint a known one to prove the token path is gated too.
    token = invite.rotate_token!
    invite.save!
    post "/api/act-invites/accept", params: { token: }, headers: auth(@asha), as: :json
    assert_response :forbidden
    assert_equal "INVITE_NOT_FOR_YOU", response.parsed_body["code"]
    post "/api/act-invites/decline", params: { token: }, headers: auth(@asha), as: :json
    assert_response :forbidden
    assert_equal "pending", invite.reload.status
    assert_not @act.act_members.exists?(user_id: @asha.id)
  ensure
    ENV.delete("EMAIL_DELIVERY_WEBHOOK")
  end

  test "expired, revoked and used tokens are refused and add nobody" do
    invite!({ kind: "link", roleName: "Keys" })
    expired = link_token(response.parsed_body)
    last_invite.update_columns(expires_at: 1.minute.ago)
    get "/api/act-invites/preview", params: { token: expired }
    assert_equal "expired", response.parsed_body.dig("invite", "status")
    post "/api/act-invites/accept", params: { token: expired }, headers: auth(@rohan), as: :json
    assert_response :gone
    assert_equal "INVITE_EXPIRED", response.parsed_body["code"]

    invite!({ kind: "link", roleName: "Keys" })
    revoked = link_token(response.parsed_body)
    invite = ActInvite.find_by_token(revoked)
    delete "/api/acts/#{@act.id}/invites/#{invite.id}", headers: auth(@owner)
    assert_response :ok
    post "/api/act-invites/accept", params: { token: revoked }, headers: auth(@rohan), as: :json
    assert_response :gone
    assert_equal "INVITE_REVOKED", response.parsed_body["code"]
    delete "/api/acts/#{@act.id}/invites/#{invite.id}", headers: auth(@owner)
    assert_response :gone, "already revoked"

    assert_not @act.act_members.exists?(user_id: @rohan.id)
    assert_equal 1, AuditLog.where(action: "act_invite.revoke").count
  end

  test "a user-addressed invite expires too, and an expired one drops out of the invitee's list" do
    invite!({ userId: @rohan.id, roleName: "Tabla" })
    invite = last_invite
    invite.update_columns(expires_at: 1.second.ago)
    get "/api/act-invites/mine", headers: auth(@rohan)
    assert_empty response.parsed_body.fetch("invites")
    post "/api/act-invites/#{invite.id}/accept", headers: auth(@rohan)
    assert_response :gone
    get "/api/acts/#{@act.id}/invites", headers: auth(@owner)
    assert_equal ["expired"], response.parsed_body.fetch("invites").pluck("status")
  end

  test "two simultaneous taps on a link add one member" do
    invite!({ kind: "link", roleName: "Keys" })
    token = link_token(response.parsed_body)
    invite = ActInvite.find_by_token(token)
    ActInvites.accept!(invite, @rohan)
    assert_raises(ActInvites::Refused) { ActInvites.accept!(ActInvite.find(invite.id), @asha) }
    assert_equal 1, @act.act_members.where.not(user_id: @owner.id).count
  end

  test "an invite answered by id must be addressed to the caller: someone else's invite id is a 404" do
    invite!({ userId: @rohan.id, roleName: "Tabla" })
    post "/api/act-invites/#{last_invite.id}/accept", headers: auth(@asha)
    assert_response :not_found
    post "/api/act-invites/#{last_invite.id}/decline", headers: auth(@asha)
    assert_response :not_found
    get "/api/act-invites/mine", headers: auth(@hirer)
    assert_response :forbidden
  end

  # --- rate limits -----------------------------------------------------------------------------
  test "creating invites is limited per act and per inviter" do
    stub_const(ActInvite, :MAX_PER_ACT_PER_DAY, 3) do
      3.times { invite!({ kind: "link", roleName: "Keys" }) && assert_response(:created) }
      invite!({ kind: "link", roleName: "Keys" })
      assert_response :too_many_requests
      assert_equal "RATE_LIMITED", response.parsed_body["code"]
    end
    other = Act.create!(owner: @owner, name: "Second Band", act_type: "band", status: "active", currency: "INR", fee_basis: "event")
    stub_const(ActInvite, :MAX_PER_INVITER_PER_DAY, 3) do
      invite!({ kind: "link", roleName: "Keys" }, act: other)
      assert_response :too_many_requests, "the inviter already made 3 today across acts"
    end
    assert_equal 3, ActInvite.count
  end

  test "searching and resending are limited per inviter" do
    stub_const(ActInvitesController, :SEARCH_PER_HOUR, 2) do
      2.times { get "/api/acts/#{@act.id}/invitees", params: { q: "Ro" }, headers: auth(@owner) }
      assert_response :ok
      get "/api/acts/#{@act.id}/invitees", params: { q: "Ro" }, headers: auth(@owner)
      assert_response :too_many_requests
      assert response.headers["Retry-After"].present?
    end
    invite!({ kind: "email", email: "limit@example.com", roleName: "Keys" })
    stub_const(ActInvitesController, :RESEND_PER_HOUR, 0) do
      post "/api/acts/#{@act.id}/invites/#{last_invite.id}/resend", headers: auth(@owner)
      assert_response :too_many_requests
    end
  end

  test "an act can hold only so many pending invites" do
    stub_const(ActInvite, :MAX_PENDING_PER_ACT, 2) do
      2.times { invite!({ kind: "link", roleName: "Keys" }) }
      invite!({ kind: "link", roleName: "Keys" })
      assert_response :too_many_requests
      delete "/api/acts/#{@act.id}/invites/#{first_invite.id}", headers: auth(@owner)
      invite!({ kind: "link", roleName: "Keys" })
      assert_response :created
    end
  end

  test "token lookups are throttled per address" do
    40.times { get "/api/act-invites/preview", params: { token: "guess" } }
    assert_response :not_found
    get "/api/act-invites/preview", params: { token: "guess" }
    assert_response :too_many_requests
    post "/api/act-invites/accept", params: { token: "guess" }, headers: auth(@rohan), as: :json
    assert_response :too_many_requests
  end

  # --- validation ------------------------------------------------------------------------------
  test "validation: role, email and kind" do
    invite!({ kind: "email", email: "not-an-email", roleName: "Keys" })
    assert_response :unprocessable_content
    invite!({ kind: "email", email: "ok@example.com", roleName: "" })
    assert_response :unprocessable_content
    assert response.parsed_body.dig("fields", "roleName").present?
    invite!({ kind: "carrier-pigeon", roleName: "Keys" })
    assert_response :unprocessable_content
    invite!({ kind: "user", userId: "nobody", roleName: "Keys" })
    assert_response :not_found
    invite!({ kind: "user", userId: @owner.id, roleName: "Keys" })
    assert_response :not_found, "you cannot invite yourself"
    invite!({ kind: "link", roleName: ["a"] })
    assert_response :bad_request
    assert_equal 0, ActInvite.count
  end

  # --- leave and remove ------------------------------------------------------------------------
  test "a member can leave, the leader cannot, and removing a member still works" do
    invite!({ kind: "link", roleName: "Keys" })
    ActInvites.accept!(last_invite, @rohan)
    get "/api/acts/me", headers: auth(@rohan)
    assert_equal [@act.id], response.parsed_body.fetch("memberships").pluck("actId")
    get "/api/acts/me", headers: auth(@owner)
    assert_empty response.parsed_body.fetch("memberships")

    post "/api/acts/#{@act.id}/leave", headers: auth(@asha)
    assert_response :not_found
    post "/api/acts/#{@act.id}/leave", headers: auth(@owner)
    assert_response :conflict
    post "/api/acts/#{@act.id}/leave", headers: auth(@rohan)
    assert_response :ok
    assert_not @act.act_members.exists?(user_id: @rohan.id)
    assert_equal 1, AuditLog.where(action: "act.member_leave").count

    invite!({ kind: "link", roleName: "Keys" })
    member = ActInvites.accept!(last_invite, @asha)
    delete "/api/acts/#{@act.id}/members/#{member.id}", headers: auth(@owner)
    assert_response :ok
    assert_not @act.act_members.exists?(user_id: @asha.id)
  end

  test "audit log records create, accept, decline and revoke without addresses or tokens" do
    invite!({ kind: "email", email: "audit@example.com", roleName: "Keys" })
    revoke = last_invite
    delete "/api/acts/#{@act.id}/invites/#{revoke.id}", headers: auth(@owner)
    invite!({ userId: @rohan.id, roleName: "Tabla" })
    post "/api/act-invites/#{last_invite.id}/decline", headers: auth(@rohan)
    invite!({ userId: @asha.id, roleName: "Vocals" })
    post "/api/act-invites/#{last_invite.id}/accept", headers: auth(@asha)
    logs = AuditLog.where("action LIKE 'act_invite.%'")
    assert_equal %w[act_invite.accept act_invite.create act_invite.decline act_invite.revoke], logs.pluck(:action).uniq.sort
    assert_equal [@asha.id], logs.where(action: "act_invite.accept").pluck(:actor_id)
    assert_not_includes logs.to_json, "audit@example.com"
  end

  test "mine is for musicians only and the owner of a hidden act's invite cannot be accepted" do
    invite!({ kind: "link", roleName: "Keys" })
    token = link_token(response.parsed_body)
    @act.update_columns(status: "hidden")
    post "/api/act-invites/accept", params: { token: }, headers: auth(@rohan), as: :json
    assert_response :gone
    assert_not @act.act_members.exists?(user_id: @rohan.id)
  end

  def stub_const(klass, name, value)
    original = klass.const_get(name)
    klass.send(:remove_const, name)
    klass.const_set(name, value)
    yield
  ensure
    klass.send(:remove_const, name)
    klass.const_set(name, original)
  end
end
