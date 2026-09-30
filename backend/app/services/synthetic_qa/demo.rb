# Demo batches are synthetic batches whose name starts with "demo-". Unlike other
# synthetic QA batches they are shown in public listings (with a "Demo" badge) so the
# owner can preview a populated marketplace, and they can be created and purged from
# the admin UI. They are never loginable with a known password.
module SyntheticQa
  module Demo
    PREFIX = "demo-".freeze
    MAX_USERS = 300
    # The hand-written "Verse showcase" (SyntheticQa::Showcase): fixed batch name, so seeding it is idempotent.
    SHOWCASE_BATCH = "demo-showcase".freeze
    SHOWCASE_SIZE = "showcase".freeze
    SIZES = {
      SHOWCASE_SIZE => { jobseekers: 110, employers: 40 },
      "small" => { jobseekers: 20, employers: 8 },
      "medium" => { jobseekers: 60, employers: 20 },
      "large" => { jobseekers: 150, employers: 50 }
    }.freeze
    # A queued or running demo job older than this is treated as dead (e.g. the process
    # restarted mid-run) so it never blocks the admin forever.
    STALE_AFTER = 30.minutes
    ADVISORY_LOCK_KEY = 0x0de30da7a

    module_function

    def batch?(name) = name.to_s.start_with?(PREFIX)

    def user?(user) = user.present? && batch?(user.synthetic_batch)

    # Any synthetic account (QA or demo). Background jobs that email, badge or count people skip these.
    def synthetic_user?(user) = user.present? && user.synthetic_batch.present?

    def showcase? = User.exists?(synthetic_batch: SHOWCASE_BATCH)

    # Untagged users plus demo batches; every other synthetic batch stays hidden.
    def publicly_listed(scope)
      scope.where("users.synthetic_batch IS NULL OR users.synthetic_batch LIKE ?", "#{PREFIX}%")
    end

    def users = User.where("synthetic_batch LIKE ?", "#{PREFIX}%")

    def batch_names = users.distinct.order(:synthetic_batch).pluck(:synthetic_batch)

    def next_batch_name(now = Time.current)
      base = "#{PREFIX}#{now.utc.strftime('%Y%m%d-%H%M')}"
      return base unless User.exists?(synthetic_batch: base)
      "#{base}#{now.utc.strftime('%S')}-#{SecureRandom.alphanumeric(4).downcase}"
    end

    # Serialises the "is another demo job running?" check with the enqueue, across processes.
    # Returns :locked when another request holds the lock. The lock is transaction-scoped,
    # so Postgres releases it at commit or rollback even if this process dies mid-request,
    # and a pooled connection can never keep it.
    def with_admin_lock
      ApplicationRecord.transaction(requires_new: true) do
        locked = ApplicationRecord.lease_connection.select_value("SELECT pg_try_advisory_xact_lock(#{ADVISORY_LOCK_KEY})")
        next :locked unless locked
        yield
      end
    end
  end
end
