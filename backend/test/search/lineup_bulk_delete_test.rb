require "test_helper"

# Lineup members removed in bulk (delete_all skips ActMember's callbacks) must not stay findable
# in the acts they played in.
class LineupBulkDeleteTest < ActiveSupport::TestCase
  setup do
    @owner = person("Real Owner")
    @act = Act.create!(owner: @owner, name: "Night Owls", act_type: "band", city: "Pune", currency: "INR", fee_basis: "event", status: "active")
  end

  test "erasing an account rebuilds the documents of the acts the person played in" do
    leaving = person("Leaving Player")
    @act.act_members.create!(user: leaving, display_name: leaving.name, role_name: "Shehnai Player", instrument: "Shehnai", member_status: "confirmed")
    assert_includes act_text, "shehnai"
    AccountErasure.new(leaving).call!
    assert_not_includes act_text, "shehnai"
  end

  test "purging a synthetic batch rebuilds the documents of real acts its accounts played in" do
    synthetic = person("Batch Player", synthetic_batch: "local-qa-lineup")
    @act.act_members.create!(user: synthetic, display_name: synthetic.name, role_name: "Santoor Player", instrument: "Santoor", member_status: "confirmed")
    assert_includes act_text, "santoor"
    SyntheticQa::BatchCleanup.call(batch: "local-qa-lineup")
    assert_not_includes act_text, "santoor"
  end

  private

  def act_text = ActiveRecord::Base.lease_connection.select_value("SELECT search_text FROM acts WHERE id = #{ActiveRecord::Base.lease_connection.quote(@act.id)}")

  def person(name, synthetic_batch: nil)
    User.create!(name:, email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.invalid", password: "StrongPass123!", role: "jobseeker",
      status: "active", profile_complete: true, synthetic_batch:).tap { _1.create_profile!(headline: "Session player") }
  end
end
