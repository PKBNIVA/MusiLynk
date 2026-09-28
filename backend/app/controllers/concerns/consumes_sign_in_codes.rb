# Spending one attempt on a SignInCode. Shared by the sign-in flows (AuthController) and
# the admin email change (Admin::AccountController), so every code has the same lifetime,
# single use and attempt cap.
module ConsumesSignInCodes
  extend ActiveSupport::Concern

  private

  # Spends one attempt on the newest usable code for the address and returns it
  # (marked used) when the code matches. The row lock serialises concurrent
  # guesses so the attempt cap cannot be raced.
  def consume_sign_in_code(email, raw)
    candidate = SignInCode.latest_usable_for(email)
    # Keep the no-code path doing the same HMAC work as the has-code path.
    unless candidate
      SignInCode.new(id: "sign_placeholder", code_digest: "").matches?(raw)
      return nil
    end
    consume_code(candidate, raw)
  end

  def consume_code(candidate, raw)
    matched = false
    candidate.with_lock do
      next if candidate.used_at? || candidate.expires_at <= Time.current || candidate.attempts >= SignInCode::MAX_ATTEMPTS
      candidate.attempts += 1
      matched = candidate.matches?(raw)
      candidate.used_at = Time.current if matched || candidate.attempts >= SignInCode::MAX_ATTEMPTS
      candidate.save!
    end
    candidate if matched
  end
end
