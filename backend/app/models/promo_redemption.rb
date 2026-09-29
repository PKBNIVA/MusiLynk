# One row per use of a PromoCode by a user. Written only by PromoCodes::Redeemer.
class PromoRedemption < ApplicationRecord
  belongs_to :promo_code
  belongs_to :user
  belongs_to :subscription, optional: true
  has_one :billing_credit, dependent: nil
end
