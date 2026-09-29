# The one-click cancel link sent in lifecycle reminder emails (see BillingRemindersJob /
# NotificationEmail). The token is a Rails signed message carrying the subscription id and the
# user id it was minted for, expiring in 14 days: verifying it never cancels anything by itself —
# it only tells the billing page whose cancel dialog to open, pre-focused, for a person who is
# already signed in as that user (see src/app/pages/Billing.tsx). Clicking through still requires
# the existing POST /api/billing/cancel action.
class BillingCancelToken
  PURPOSE = :billing_cancel
  EXPIRES_IN = 14.days

  def self.verifier = Rails.application.message_verifier(PURPOSE)

  def self.generate(subscription)
    verifier.generate({ "subscription_id" => subscription.id, "user_id" => subscription.user_id },
      purpose: PURPOSE, expires_in: EXPIRES_IN)
  end

  # Returns the subscription the token names, only when it verifies, has not expired, and names
  # the given user — otherwise nil.
  def self.subscription_for(token, user)
    payload = verifier.verified(token.to_s, purpose: PURPOSE)
    return nil unless payload.is_a?(Hash) && payload["user_id"] == user&.id

    Subscription.find_by(id: payload["subscription_id"], user_id: user.id)
  rescue StandardError
    nil
  end
end
