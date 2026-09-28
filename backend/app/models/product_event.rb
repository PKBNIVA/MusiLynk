# A single funnel-analytics event (POST /api/events). Self-hosted, no third party: this table is
# the whole store. Never holds an email address or free text — EventsController enforces the
# name allow-list and a 1KB per-event size cap before a row is ever created.
class ProductEvent < ApplicationRecord
  belongs_to :user, optional: true

  validates :anon_id, :name, presence: true

  scope :named, ->(name) { where(name: name) }
  scope :since, ->(time) { where(created_at: time..) }
end
