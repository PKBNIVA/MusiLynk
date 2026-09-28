# One row per (urgent_request, candidate, channel) alert actually sent: written by
# UrgentMatcher.notify! (the automatic pass) and by Admin::UrgentRequestsController#notify
# (a founder's manual click). The unique index on the three columns makes both idempotent —
# calling either twice never double-notifies the same person on the same channel.
class UrgentRequestNotification < ApplicationRecord
  CHANNELS = %w[in_app email whatsapp].freeze

  belongs_to :urgent_request
  belongs_to :user
  belongs_to :notified_by_admin, class_name: "User", optional: true

  validates :channel, inclusion: { in: CHANNELS }
end
