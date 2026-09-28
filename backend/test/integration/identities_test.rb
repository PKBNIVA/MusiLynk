require "test_helper"

class IdentitiesTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(name: "Riya Keys", email: "riya-identity@example.com", password: "Harbor-Lantern-4827!", role: "employer", status: "active")
    @stranger = User.create!(name: "Other Person", email: "other-identity@example.com", password: "Harbor-Lantern-4827!", role: "employer", status: "active")
    @studio = Organization.create!(owner: @user, name: "Riya Studios", status: "active")
    @studio.organization_members.create!(user: @user, role: "owner")
    @label = Organization.create!(owner: @stranger, name: "Some Label", status: "active")
    @label.organization_members.create!(user: @stranger, role: "owner")
    @label.organization_members.create!(user: @user, role: "member")
    @band = Act.create!(owner: @user, name: "The Night Shift", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
    @hidden_band = Act.create!(owner: @user, name: "Old Hidden Act", act_type: "band", currency: "INR", fee_basis: "event", status: "hidden")
  end

  test "lists yourself, pages you manage and acts you own, but not pages where you are only a member" do
    get "/api/me/identities", headers: bearer(token_for(@user))
    assert_response :success
    keys = response.parsed_body["identities"].pluck("key")
    assert_equal "user:#{@user.id}", keys.first
    assert_includes keys, "organization:#{@studio.id}"
    assert_includes keys, "act:#{@band.id}"
    assert_not_includes keys, "organization:#{@label.id}", "a plain member cannot act as the page"
    assert_not_includes keys, "act:#{@hidden_band.id}"
  end

  test "resolve accepts managed identities and refuses everything else" do
    assert ActorResolver.resolve(@user, nil).user?
    assert_equal @studio, ActorResolver.resolve(@user, "organization:#{@studio.id}").record
    assert_equal @band, ActorResolver.resolve(@user, "act:#{@band.id}").record
    assert_nil ActorResolver.resolve(@user, "organization:#{@label.id}")
    assert_nil ActorResolver.resolve(@user, "user:#{@stranger.id}")
    assert_nil ActorResolver.resolve(@user, "act:")
    assert_nil ActorResolver.resolve(@user, "venue:123")
    assert_nil ActorResolver.resolve(@stranger, "act:#{@band.id}")
  end

  test "an organization admin can act as it, and a suspended page drops out" do
    @label.organization_members.where(user: @user).update_all(role: "admin")
    assert ActorResolver.resolve(@user, "organization:#{@label.id}")
    @label.update!(status: "suspended")
    assert_nil ActorResolver.resolve(@user, "organization:#{@label.id}")
  end

  test "signed-out requests are refused" do
    get "/api/me/identities"
    assert_response :unauthorized
  end

  private

  def token_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end

  def bearer(token) = { "Authorization" => "Bearer #{token}" }
end
