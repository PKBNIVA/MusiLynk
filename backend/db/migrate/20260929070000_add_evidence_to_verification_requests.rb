# Verification automation: every request gets an evidence score (0-100) with its breakdown and
# flags, an automatic decision marker (never a rejection), an audit-sample marker for the
# human spot-check queue, and a short factual summary for the admin queue.
#
# Lock profile: six new nullable/defaulted columns on a small table; the partial index covers
# only audit-sample rows.
class AddEvidenceToVerificationRequests < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :verification_requests, :evidence_score, :integer
    add_column :verification_requests, :evidence_breakdown, :jsonb, null: false, default: {}
    add_column :verification_requests, :flags, :jsonb, null: false, default: []
    add_column :verification_requests, :auto_decision, :string
    add_column :verification_requests, :audit_sample, :boolean, null: false, default: false
    add_column :verification_requests, :summary, :text

    add_check_constraint :verification_requests, "auto_decision IN ('auto_approved', 'needs_more_proof')",
      name: "verification_requests_auto_decision_valid"
    add_index :verification_requests, :audit_sample, where: "audit_sample", name: "idx_verification_requests_audit_sample"
  end
end
