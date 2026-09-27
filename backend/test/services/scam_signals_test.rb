require "test_helper"

class ScamSignalsTest < ActiveSupport::TestCase
  def signals(text, **context) = ScamSignals.detect(text, **context)

  UPFRONT_FEE = [
    "Congratulations, you are shortlisted! Registration fee is Rs 1500, pay today.",
    "Audition fees ₹999 to be paid before Friday.",
    "Please pay the audition fee to confirm your slot",
    "Selected for the music video. Pay 2000 as registration charges.",
    "Fees for registration: 500 rupees",
    "registration ke liye 1000 rs dena hoga",
    "Audition ke liye fees jama karo aaj",
    "Aapko audition confirm karne ke liye 500 pay karna hoga",
    "Casting charges 3000, refundable after the shoot",
    "Profile activation fee 499 for premium gigs",
    "रजिस्ट्रेशन फीस 500 रुपये भेजें",
    "Portfolio charges of 2500 apply before the shoot"
  ].freeze

  NEAR_MISS = [
    "There is no registration fee for this audition.",
    "Registration fee nahi hai, bas apna showreel bhejo.",
    "Registration is free, just fill the form.",
    "We never ask for audition fees. Please report anyone who does.",
    "My fee for the wedding gig is ₹25,000 plus travel.",
    "What are your fees for a 2 hour set?",
    "We pay artists ₹3000 per audition round.",
    "Please pay attention to the audition timing, it starts at 10.",
    "Audition is on Friday at the studio, bring your guitar.",
    "The venue charges a small deposit for the green room; we cover it.",
    "Advance payment ka kya scene hai? Hum 50% advance dete hain.",
    "I'll send the advance tomorrow once the contract is signed.",
    "Share your UPI and I'll transfer the advance tonight.",
    "Let's keep chatting here on Verse.",
    "I'll share my WhatsApp after we finalise the date.",
    "Call me on the studio landline tomorrow.",
    "Call time is 9876 hours? No, 9 am sharp."
  ].freeze

  UPFRONT_FEE.each do |text|
    test "upfront fee: #{text}" do
      assert_includes signals(text), "upfront_fee"
    end
  end

  NEAR_MISS.each do |text|
    test "near miss: #{text}" do
      assert_empty signals(text)
    end
  end

  test "an advance demanded of the talent by the hiring side is flagged" do
    ["You have to pay 2000 advance to book the slot", "Pehle advance jama karo phir booking confirm hogi", "Advance dena hoga 1500"].each do |text|
      assert_includes signals(text), "upfront_fee", text
    end
  end

  test "talent asking the hirer for an advance is normal business" do
    assert_empty signals("You have to pay 50% advance to confirm my booking.", from_hiring_side: false)
    assert_empty signals("Advance dena hoga 5000, baaki show ke baad.", from_hiring_side: false)
  end

  test "an audition fee is flagged whichever side sends it" do
    assert_includes signals("Audition fee 500 dena hoga", from_hiring_side: false), "upfront_fee"
  end

  test "payment details from the hiring side are flagged" do
    ["Pay on castingteam@okaxis now", "UPI: rahul.k@ybl", "Transfer to A/c no 123456789012 IFSC HDFC0001234",
     "Send the amount on my gpay", "Paytm pe bhejo 500"].each do |text|
      assert_includes signals(text), "payment_details", text
    end
  end

  test "talent sharing their own payment details is not flagged" do
    assert_empty signals("My UPI is singer.priya@okhdfcbank for the balance", from_hiring_side: false)
    assert_empty signals("Can you share your UPI id so we can pay the advance?")
  end

  test "an early push to WhatsApp or Telegram with a phone number is flagged" do
    ["WhatsApp me on 98765 43210 for details", "Telegram par message karo +91-9876543210", "Contact on whatsapp 9876543210 urgently", "wa.me/919876543210"].each do |text|
      assert_includes signals(text), "off_platform", text
    end
  end

  test "moving to WhatsApp later in an established conversation is not flagged" do
    assert_empty signals("WhatsApp me on 9876543210 for the rider", early: false)
  end

  test "a phone number without a chat app, or a chat app without a number, is not flagged" do
    assert_empty signals("My number is 9876543210 if the venue needs it")
    assert_empty signals("Do you use WhatsApp or Telegram?")
  end

  test "one message can carry several signals, in a stable order" do
    text = "Registration fee 500. Pay to casting@ybl and WhatsApp 9876543210"
    assert_equal %w[upfront_fee payment_details off_platform], signals(text)
  end

  test "blank and non-string input is safe" do
    assert_empty signals("")
    assert_empty signals(nil)
    assert_empty signals("   \n")
  end
end
