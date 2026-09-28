class Organization < ApplicationRecord
  belongs_to :owner, class_name: "User"
  has_many :organization_members, dependent: :destroy
  has_many :portfolios, -> { where(owner_type: "organization") }, foreign_key: :owner_id, dependent: :destroy, inverse_of: false
  validates :website, safe_http_url: true, allow_blank: true
  validates :name, presence: true, length: { maximum: 120 }
end
