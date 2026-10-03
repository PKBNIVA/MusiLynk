class ActMember < ApplicationRecord
  belongs_to :act
  belongs_to :user, optional: true
  # Lineup roles and instruments are part of the act's search document.
  after_save { Search::Indexer.refresh("acts", act_id) if previously_new_record? || saved_changes.keys.intersect?(%w[role_name instrument act_id]) }
  after_destroy { Search::Indexer.refresh("acts", act_id) }
  validates :display_name, :role_name, presence: true
  validates :member_status, presence: true
  def api_json = { id:, userId: user_id, displayName: display_name, roleName: role_name, instrument:, isLeader: is_leader, memberStatus: member_status }
  def public_json = { id:, displayName: display_name, roleName: role_name, instrument:, isLeader: is_leader }
end
