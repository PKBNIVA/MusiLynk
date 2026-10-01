require "test_helper"

# The Stage community feed: posts (as yourself or as a Page), applause, comments, reshares,
# shares, follows, hashtag search, moderation and notifications.
class StageTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @alice = create_user("Alice Stage", "jobseeker", { location: "Mumbai", genres: ["Jazz"] })
    @bob = create_user("Bob Stage", "jobseeker", { location: "Pune", genres: ["Rock"] })
    @org_owner = create_user("Org Owner", "employer")
    @org = Organization.create!(owner: @org_owner, name: "Owner Studio", status: "active")
    @org.organization_members.create!(user: @org_owner, role: "owner")
    @act_owner = create_user("Act Owner", "jobseeker")
    @act = Act.create!(owner: @act_owner, name: "The Act", act_type: "band", status: "active", currency: "INR", fee_basis: "event")
  end

  # ---- Posting -------------------------------------------------------------

  test "creates a post as yourself" do
    post "/api/stage/posts", params: { body: "Hello stage #Jazz" }, headers: auth(@alice), as: :json
    assert_response :created
    body = response.parsed_body
    assert_equal "user", body["post"]["author"]["type"]
    assert_equal @alice.id, body["post"]["author"]["id"]
    assert_includes body["post"]["hashtags"], "jazz"
    assert Post.exists?(id: body["id"], created_by_user_id: @alice.id)
  end

  test "creates a post acting as a Page you run" do
    post "/api/stage/posts", params: { body: "From the studio" }, headers: auth(@org_owner).merge("X-Verse-Act-As" => "organization:#{@org.id}"), as: :json
    assert_response :created
    body = response.parsed_body
    assert_equal "organization", body["post"]["author"]["type"]
    assert_equal @org.id, body["post"]["author"]["id"]
    saved = Post.find(body["id"])
    assert_equal @org_owner.id, saved.created_by_user_id, "the real person is kept for audit"
  end

  test "refuses to post as a Page you do not run" do
    other_org = Organization.create!(owner: @org_owner, name: "Someone Else's Org", status: "active")
    post "/api/stage/posts", params: { body: "Not mine" }, headers: auth(@bob).merge("X-Verse-Act-As" => "organization:#{other_org.id}"), as: :json
    assert_response :forbidden
    assert_equal "ACT_AS_FORBIDDEN", response.parsed_body["code"]
  end

  test "requires a body or a shared item" do
    post "/api/stage/posts", params: {}, headers: auth(@alice), as: :json
    assert_response :unprocessable_content
  end

  test "rejects a body over 3000 characters" do
    post "/api/stage/posts", params: { body: "x" * 3001 }, headers: auth(@alice), as: :json
    assert_response :unprocessable_content
  end

  test "shares a portfolio item you own" do
    item = PortfolioItem.create!(user: @alice, kind: "audio", title: "Take", url: "https://example.com/a.mp3", visibility: "public")
    post "/api/stage/posts", params: { kind: "portfolio_share", sharedPortfolioItemId: item.id }, headers: auth(@alice), as: :json
    assert_response :created
    assert_equal "portfolio_item", response.parsed_body["post"]["sharedEntity"]["type"]
  end

  test "refuses to share a portfolio item you do not own" do
    item = PortfolioItem.create!(user: @bob, kind: "audio", title: "Take", url: "https://example.com/b.mp3", visibility: "public")
    post "/api/stage/posts", params: { kind: "portfolio_share", sharedPortfolioItemId: item.id }, headers: auth(@alice), as: :json
    assert_response :unprocessable_content
  end

  test "shares an open job" do
    job = create_job(@org_owner, "published")
    post "/api/stage/posts", params: { kind: "job_share", sharedJobId: job.id }, headers: auth(@alice), as: :json
    assert_response :created
    assert response.parsed_body["post"]["sharedEntity"]["applyOpen"]
  end

  test "refuses to share a closed job" do
    job = create_job(@org_owner, "closed")
    post "/api/stage/posts", params: { kind: "job_share", sharedJobId: job.id }, headers: auth(@alice), as: :json
    assert_response :unprocessable_content
  end

  test "reshares a post with an optional comment" do
    original = Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Original", visibility: "public")
    post "/api/stage/posts", params: { body: "Check this out", resharedPostId: original.id }, headers: auth(@alice), as: :json
    assert_response :created
    assert_equal 1, original.reload.reshare_count
    assert_equal "post", response.parsed_body["post"]["sharedEntity"]["type"]
  end

  test "deleting a shared portfolio item still renders the post, with an unavailable preview" do
    item = PortfolioItem.create!(user: @alice, kind: "audio", title: "Take", url: "https://example.com/gone.mp3", visibility: "public")
    post "/api/stage/posts", params: { kind: "portfolio_share", sharedPortfolioItemId: item.id }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    item.destroy!

    get "/api/stage/posts/#{id}"
    assert_response :success
    assert_equal({ "type" => "portfolio_item", "unavailable" => true }, response.parsed_body["post"]["sharedEntity"])
  end

  test "closing a job that was shared still renders it, with applyOpen false" do
    job = create_job(@org_owner, "published")
    post "/api/stage/posts", params: { kind: "job_share", sharedJobId: job.id }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    job.update!(status: "closed")

    get "/api/stage/posts/#{id}"
    assert_response :success
    shared = response.parsed_body["post"]["sharedEntity"]
    assert_equal "job", shared["type"]
    refute shared["applyOpen"]
  end

  test "deleting the original post of a reshare still renders the reshare, without a shared preview" do
    original = Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Original", visibility: "public")
    post "/api/stage/posts", params: { body: "Check this out", resharedPostId: original.id }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    original.destroy!

    get "/api/stage/posts/#{id}"
    assert_response :success
    assert_equal "Check this out", response.parsed_body["post"]["body"]
    assert_nil response.parsed_body["post"]["sharedEntity"]
  end

  test "shows, updates and soft-deletes your own post" do
    post "/api/stage/posts", params: { body: "Mine" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    get "/api/stage/posts/#{id}"
    assert_response :success

    patch "/api/stage/posts/#{id}", params: { body: "Edited" }, headers: auth(@alice), as: :json
    assert_response :success
    assert_equal "Edited", response.parsed_body["post"]["body"]

    delete "/api/stage/posts/#{id}", headers: auth(@alice), as: :json
    assert_response :success
    assert_equal "deleted", Post.find(id).status

    get "/api/stage/posts/#{id}"
    assert_response :not_found
  end

  test "cannot edit or delete someone else's post" do
    post "/api/stage/posts", params: { body: "Mine" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    patch "/api/stage/posts/#{id}", params: { body: "Hijacked" }, headers: auth(@bob), as: :json
    assert_response :forbidden

    delete "/api/stage/posts/#{id}", headers: auth(@bob), as: :json
    assert_response :forbidden
  end

  test "lists posts by author" do
    post "/api/stage/posts", params: { body: "First" }, headers: auth(@alice), as: :json
    post "/api/stage/posts", params: { body: "Second" }, headers: auth(@alice), as: :json

    get "/api/stage/authors/user/#{@alice.id}/posts"
    assert_response :success
    assert_equal 2, response.parsed_body["posts"].length
  end

  test "enforces the posting rate limit" do
    with_real_cache do
      Stage::PostsController::CREATE_LIMIT_PER_HOUR.pred.times do |n|
        Rails.cache.increment("user-rate:stage.posts:#{@alice.id}:#{Time.current.to_i / 1.hour}", 1, expires_in: 1.hour)
      end
      post "/api/stage/posts", params: { body: "Under the limit" }, headers: auth(@alice), as: :json
      assert_response :created
      post "/api/stage/posts", params: { body: "One too many" }, headers: auth(@alice), as: :json
      assert_response :too_many_requests
      assert_equal "RATE_LIMITED", response.parsed_body["code"]
    end
  end

  # ---- Applause -------------------------------------------------------------

  test "applauds and un-applauds a post, once per actor" do
    post "/api/stage/posts", params: { body: "Applaud me" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    post "/api/stage/posts/#{id}/applause", headers: auth(@bob), as: :json
    assert_response :created
    assert_equal 1, response.parsed_body["applauseCount"]

    post "/api/stage/posts/#{id}/applause", headers: auth(@bob), as: :json
    assert_response :created
    assert_equal 1, response.parsed_body["applauseCount"], "applauding twice does not double count"

    get "/api/stage/posts/#{id}"
    assert response.parsed_body["post"]["applauded"] == false # viewed anonymously

    delete "/api/stage/posts/#{id}/applause", headers: auth(@bob), as: :json
    assert_response :success
    assert_equal 0, response.parsed_body["applauseCount"]
  end

  test "blocked users cannot applaud each other's posts" do
    post "/api/stage/posts", params: { body: "Blocked test" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]
    UserBlock.create!(blocker: @alice, blocked: @bob)

    post "/api/stage/posts/#{id}/applause", headers: auth(@bob), as: :json
    assert_response :forbidden
  end

  # ---- Comments -------------------------------------------------------------

  test "comments on a post and replies one level deep" do
    post "/api/stage/posts", params: { body: "Comment on me" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    post "/api/stage/posts/#{id}/comments", params: { body: "Nice!" }, headers: auth(@bob), as: :json
    assert_response :created
    top = response.parsed_body["id"]

    post "/api/stage/posts/#{id}/comments", params: { body: "Thanks!", parentId: top }, headers: auth(@alice), as: :json
    assert_response :created

    get "/api/stage/posts/#{id}/comments"
    assert_equal 2, response.parsed_body["comments"].length
    assert_equal 2, Post.find(id).comment_count
  end

  test "deletes your own comment, or any comment on your own post" do
    post "/api/stage/posts", params: { body: "Owner post" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]
    post "/api/stage/posts/#{id}/comments", params: { body: "By bob" }, headers: auth(@bob), as: :json
    comment_id = response.parsed_body["id"]

    delete "/api/stage/comments/#{comment_id}", headers: auth(@alice), as: :json
    assert_response :success
    assert_equal "deleted", PostComment.find(comment_id).status
    assert_equal 0, Post.find(id).comment_count
  end

  test "cannot delete someone else's comment on someone else's post" do
    post "/api/stage/posts", params: { body: "Owner post" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]
    post "/api/stage/posts/#{id}/comments", params: { body: "By bob" }, headers: auth(@bob), as: :json
    comment_id = response.parsed_body["id"]

    carol = create_user("Carol Stage", "jobseeker")
    delete "/api/stage/comments/#{comment_id}", headers: auth(carol), as: :json
    assert_response :forbidden
  end

  test "blocked users cannot comment on each other's posts" do
    post "/api/stage/posts", params: { body: "Blocked comment test" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]
    UserBlock.create!(blocker: @alice, blocked: @bob)

    post "/api/stage/posts/#{id}/comments", params: { body: "Hi" }, headers: auth(@bob), as: :json
    assert_response :forbidden
  end

  # ---- Follows -------------------------------------------------------------

  test "follows and unfollows a person, with follower/following counts" do
    post "/api/stage/follows", params: { followableType: "user", followableId: @bob.id }, headers: auth(@alice), as: :json
    assert_response :created

    get "/api/stage/authors/user/#{@bob.id}/followers"
    assert_equal 1, response.parsed_body["followersCount"]

    get "/api/stage/authors/user/#{@bob.id}/following", headers: auth(@alice)
    assert_response :success

    delete "/api/stage/follows/user/#{@bob.id}", headers: auth(@alice), as: :json
    assert_response :success

    get "/api/stage/authors/user/#{@bob.id}/followers"
    assert_equal 0, response.parsed_body["followersCount"]
  end

  test "cannot follow yourself" do
    post "/api/stage/follows", params: { followableType: "user", followableId: @alice.id }, headers: auth(@alice), as: :json
    assert_response :unprocessable_content
  end

  # ---- Visibility & moderation -------------------------------------------------------------

  test "a followers-only post is hidden from non-followers and shown to followers" do
    post "/api/stage/posts", params: { body: "Followers only", visibility: "followers" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    get "/api/stage/posts/#{id}"
    assert_response :not_found

    post "/api/stage/follows", params: { followableType: "user", followableId: @alice.id }, headers: auth(@bob), as: :json
    get "/api/stage/posts/#{id}", headers: auth(@bob)
    assert_response :success
  end

  test "a hidden or deleted post is not visible even to its author" do
    post "/api/stage/posts", params: { body: "Will be hidden" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]
    Post.find(id).update!(status: "hidden")

    get "/api/stage/posts/#{id}"
    assert_response :not_found
  end

  test "reports a post and an admin hides it" do
    post "/api/stage/posts", params: { body: "Reportable" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    post "/api/reports", params: { entityType: "post", entityId: id, reason: "Spam or scam" }, headers: auth(@bob), as: :json
    assert_response :created
    report_id = response.parsed_body["id"]

    admin = create_user("Admin Stage", "admin")
    post "/api/admin/reports/#{report_id}/moderate", params: { decision: "hide_post" }, headers: auth(admin), as: :json
    assert_response :success
    assert_equal "hidden", Post.find(id).status

    get "/api/stage/posts/#{id}"
    assert_response :not_found
  end

  test "reports a comment and an admin hides it" do
    post "/api/stage/posts", params: { body: "Owner post" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]
    post "/api/stage/posts/#{id}/comments", params: { body: "Rude comment" }, headers: auth(@bob), as: :json
    comment_id = response.parsed_body["id"]

    post "/api/reports", params: { entityType: "comment", entityId: comment_id, reason: "Harassment" }, headers: auth(@alice), as: :json
    assert_response :created
    report_id = response.parsed_body["id"]

    admin = create_user("Admin Stage2", "admin")
    post "/api/admin/reports/#{report_id}/moderate", params: { decision: "hide_comment" }, headers: auth(admin), as: :json
    assert_response :success
    assert_equal "hidden", PostComment.find(comment_id).status
  end

  # ---- Hashtags -------------------------------------------------------------

  test "searches posts by hashtag" do
    post "/api/stage/posts", params: { body: "Loving this #Jazz gig" }, headers: auth(@alice), as: :json
    post "/api/stage/posts", params: { body: "Nothing to do with music" }, headers: auth(@bob), as: :json

    get "/api/stage/tags/jazz"
    assert_response :success
    assert_equal 1, response.parsed_body["posts"].length
  end

  # ---- Audit fixes (A-30..A-39) ---------------------------------------------------------------

  test "the feed cursor keeps advancing as time decay re-ranks posts between requests" do
    25.times { |n| Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Decay #{n}", applause_count: n, visibility: "public") }

    get "/api/stage/feed", headers: auth(@alice)
    first_page = response.parsed_body
    assert_equal 20, first_page["posts"].length

    travel_to 5.hours.from_now do
      get "/api/stage/feed", params: { cursor: first_page["nextCursor"] }, headers: auth(@alice)
      second_page = response.parsed_body
      assert_equal 5, second_page["posts"].length
      assert_empty (first_page["posts"].map { _1["id"] } & second_page["posts"].map { _1["id"] })
      assert_nil second_page["nextCursor"], "the last page ends the feed"
    end
  end

  test "post media carries a public url for every viewer, only for the author's own finished uploads" do
    upload = Upload.create!(user: @alice, storage: "s3", key: "uploads/#{@alice.id}/a/photo.jpg", filename: "photo.jpg", content_type: "image/jpeg",
      byte_size: 1000, status: "complete", public_url: "https://cdn.example.com/photo.jpg")
    foreign = Upload.create!(user: @bob, storage: "s3", key: "uploads/#{@bob.id}/b/other.jpg", filename: "other.jpg", content_type: "image/jpeg",
      byte_size: 1000, status: "complete", public_url: "https://cdn.example.com/other.jpg")
    post "/api/stage/posts", params: { body: "Photo day", media: [{ uploadId: upload.id, type: "image" }, { uploadId: foreign.id, type: "image" }] },
      headers: auth(@alice), as: :json
    assert_response :created

    get "/api/stage/posts/#{response.parsed_body["id"]}", headers: auth(@bob)
    media = response.parsed_body["post"]["media"]
    assert_equal "https://cdn.example.com/photo.jpg", media.first["url"]
    assert_nil media.last["url"]
  end

  test "stage post uploads are not swept as unreferenced" do
    upload = Upload.create!(user: @alice, storage: "s3", key: "uploads/#{@alice.id}/a/p.jpg", filename: "p.jpg", content_type: "image/jpeg",
      byte_size: 1000, status: "complete", public_url: "https://cdn.example.com/p.jpg", created_at: 3.days.ago)
    assert_includes Upload.unreferenced, upload
    Post.create!(author_type: "user", author_id: @alice.id, created_by_user_id: @alice.id, body: "Pic", media: [{ uploadId: upload.id, type: "image" }])
    assert_not_includes Upload.unreferenced, upload
    assert upload.referenced?
  end

  test "media of a deleted stage post no longer counts as referenced" do
    upload = Upload.create!(user: @alice, storage: "s3", key: "uploads/#{@alice.id}/a/q.jpg", filename: "q.jpg", content_type: "image/jpeg",
      byte_size: 1000, status: "complete", public_url: "https://cdn.example.com/q.jpg", created_at: 3.days.ago)
    gone = Post.create!(author_type: "user", author_id: @alice.id, created_by_user_id: @alice.id, body: "Pic", media: [{ uploadId: upload.id, type: "image" }])
    assert upload.referenced?
    gone.update!(status: "deleted")
    assert_not upload.referenced?
    assert_includes Upload.unreferenced, upload
  end

  test "resharing notifies the original author, but not when resharing your own post" do
    original = Post.create!(author_type: "user", author_id: @alice.id, created_by_user_id: @alice.id, body: "Original", visibility: "public")
    post "/api/stage/posts", params: { body: "Worth a look", resharedPostId: original.id }, headers: auth(@bob), as: :json
    assert_response :created
    note = @alice.notifications.find_by(kind: "stage_reshare")
    assert_equal "/stage/posts/#{response.parsed_body["id"]}", note.link

    assert_no_difference -> { @alice.notifications.count } do
      post "/api/stage/posts", params: { body: "Again", resharedPostId: original.id }, headers: auth(@alice), as: :json
    end
  end

  test "replying to a comment notifies the commenter, once, and not the post owner twice" do
    post "/api/stage/posts", params: { body: "Thread" }, headers: auth(@alice), as: :json
    post_id = response.parsed_body["id"]
    post "/api/stage/posts/#{post_id}/comments", params: { body: "Top level" }, headers: auth(@bob), as: :json
    comment_id = response.parsed_body["id"]
    carol = create_user("Carol Stage", "jobseeker")

    post "/api/stage/posts/#{post_id}/comments", params: { body: "Replying to Bob", parentId: comment_id }, headers: auth(carol), as: :json
    assert_response :created
    assert_equal 1, @bob.notifications.where(kind: "stage_reply").count

    assert_no_difference -> { @bob.notifications.count } do
      post "/api/stage/posts/#{post_id}/comments", params: { body: "Replying to myself", parentId: comment_id }, headers: auth(@bob), as: :json
    end

    post "/api/stage/posts/#{post_id}/comments", params: { body: "Alice's comment" }, headers: auth(@alice), as: :json
    alice_comment = response.parsed_body["id"]
    assert_difference -> { @alice.notifications.where(kind: "stage_reply").count }, 0 do
      post "/api/stage/posts/#{post_id}/comments", params: { body: "Reply to the owner", parentId: alice_comment }, headers: auth(@bob), as: :json
    end
  end

  test "hashtags keep letters from every script and ignore single characters" do
    assert_equal %w[मुंबई jazz_night tabla], Post.extract_hashtags("#मुंबई #Jazz_Night #a #tabla")
    post "/api/stage/posts", params: { body: "Aaj ki raat #संगीत" }, headers: auth(@alice), as: :json
    get "/api/stage/tags/#{ERB::Util.url_encode("संगीत")}"
    assert_response :success
    assert_equal 1, response.parsed_body["posts"].length
  end

  test "an author endpoint answers for members without posts and 404s for unknown ones" do
    get "/api/stage/authors/user/#{@alice.id}", headers: auth(@bob)
    assert_response :success
    assert_equal "Alice Stage", response.parsed_body["author"]["name"]

    get "/api/stage/authors/user/does-not-exist", headers: auth(@bob)
    assert_response :not_found
    get "/api/stage/authors/act/#{@act.id}"
    assert_equal "The Act", response.parsed_body["author"]["name"]
    get "/api/stage/authors/system/verse"
    assert_response :success
    get "/api/stage/authors/bogus/x"
    assert_response :unprocessable_content
  end

  # ---- Notifications -------------------------------------------------------------

  test "notifies the author on applause and comment, coalesced per post" do
    post "/api/stage/posts", params: { body: "Notify me" }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]

    post "/api/stage/posts/#{id}/applause", headers: auth(@bob), as: :json
    assert_equal 1, @alice.notifications.where(kind: "stage_applause").count

    carol = create_user("Carol Notif", "jobseeker")
    post "/api/stage/posts/#{id}/applause", headers: auth(carol), as: :json
    assert_equal 1, @alice.notifications.where(kind: "stage_applause").count, "applause on the same post coalesces into one notification"

    post "/api/stage/posts/#{id}/comments", params: { body: "Great post" }, headers: auth(@bob), as: :json
    assert_equal 1, @alice.notifications.where(kind: "stage_comment").count
  end

  test "notifies a person of a new follower" do
    post "/api/stage/follows", params: { followableType: "user", followableId: @alice.id }, headers: auth(@bob), as: :json
    assert_equal 1, @alice.notifications.where(kind: "stage_follower").count
  end

  # ---- Account erasure -------------------------------------------------------------

  test "account erasure removes this person's Stage content and recounts other people's posts" do
    item = PortfolioItem.create!(user: @alice, kind: "audio", title: "Take", url: "https://example.com/erase.mp3", visibility: "public")
    post "/api/stage/posts", params: { kind: "portfolio_share", sharedPortfolioItemId: item.id }, headers: auth(@alice), as: :json
    alice_post_id = response.parsed_body["id"]

    post "/api/stage/posts", params: { body: "Bob's post" }, headers: auth(@bob), as: :json
    bob_post_id = response.parsed_body["id"]
    post "/api/stage/posts/#{bob_post_id}/applause", headers: auth(@alice), as: :json
    post "/api/stage/posts/#{bob_post_id}/comments", params: { body: "Nice!" }, headers: auth(@alice), as: :json
    post "/api/stage/posts", params: { body: "Reshared", resharedPostId: bob_post_id }, headers: auth(@alice), as: :json
    reshare_id = response.parsed_body["id"]
    post "/api/stage/follows", params: { followableType: "user", followableId: @bob.id }, headers: auth(@alice), as: :json
    post "/api/stage/follows", params: { followableType: "user", followableId: @alice.id }, headers: auth(@bob), as: :json

    bob_post = Post.find(bob_post_id)
    assert_equal 1, bob_post.applause_count
    assert_equal 1, bob_post.comment_count
    assert_equal 1, bob_post.reload.reshare_count

    AccountErasure.new(@alice).call!

    assert_not Post.exists?(id: alice_post_id)
    assert_not Post.exists?(id: reshare_id)
    assert_empty Follow.where(follower_user_id: @alice.id)
    assert_empty Follow.where(followable_type: "user", followable_id: @alice.id)
    assert_empty PostReaction.where(actor_type: "user", actor_id: @alice.id)
    assert_empty PostComment.where(created_by_user_id: @alice.id)

    bob_post.reload
    assert_equal 0, bob_post.applause_count
    assert_equal 0, bob_post.comment_count
    assert_equal 0, bob_post.reshare_count

    get "/api/stage/posts/#{bob_post_id}"
    assert_response :success
  end

  test "account erasure keeps posts made as a Page, anonymising only the person" do
    post "/api/stage/posts", params: { body: "From the studio" }, headers: auth(@org_owner).merge("X-Verse-Act-As" => "organization:#{@org.id}"), as: :json
    org_post_id = response.parsed_body["id"]

    AccountErasure.new(@org_owner).call!

    org_post = Post.find(org_post_id)
    assert_equal "organization", org_post.author_type
    assert_equal @org_owner.id, org_post.created_by_user_id
    assert_equal "Deleted account", org_post.created_by.reload.name
  end

  # ---- Feed -------------------------------------------------------------

  test "the feed ranks followed and own posts above unrelated posts" do
    followed_post = Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Followed content", visibility: "public",
      created_at: 10.days.ago)
    unrelated_post = Post.create!(author_type: "user", author_id: @act_owner.id, created_by_user_id: @act_owner.id, body: "Unrelated content",
      visibility: "public", created_at: 1.hour.ago)
    Follow.create!(follower_user_id: @alice.id, followable_type: "user", followable_id: @bob.id)

    get "/api/stage/feed", headers: auth(@alice)
    assert_response :success
    ids = response.parsed_body["posts"].map { _1["id"] }
    assert_operator ids.index(followed_post.id), :<, ids.index(unrelated_post.id)
  end

  test "the feed paginates with a cursor and never returns hidden or deleted posts" do
    25.times { |n| Post.create!(author_type: "user", author_id: @alice.id, created_by_user_id: @alice.id, body: "Post #{n}", visibility: "public") }
    Post.create!(author_type: "user", author_id: @alice.id, created_by_user_id: @alice.id, body: "Hidden", visibility: "public", status: "hidden")

    get "/api/stage/feed", headers: auth(@alice)
    assert_response :success
    first_page = response.parsed_body
    assert_equal 20, first_page["posts"].length
    refute_nil first_page["nextCursor"]

    get "/api/stage/feed", params: { cursor: first_page["nextCursor"] }, headers: auth(@alice)
    second_page = response.parsed_body
    assert_equal 5, second_page["posts"].length
    assert_empty (first_page["posts"].map { _1["id"] } & second_page["posts"].map { _1["id"] })
  end

  test "the feed uses a bounded number of queries" do
    12.times { |n| Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Bounded #{n}", visibility: "public") }

    queries = count_queries { get "/api/stage/feed", headers: auth(@alice) }
    assert_response :success
    assert_operator queries, :<, 20, "feed should not N+1 per post"
  end

  # ---- System posts, pinning and events -------------------------------------------------------

  test "a pinned post leads the feed even when everything else is newer" do
    old_pinned = Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Old but pinned",
      visibility: "public", pinned_until: 1.day.from_now)
    old_pinned.update_column(:created_at, 3.days.ago)
    Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Brand new", visibility: "public")

    get "/api/stage/feed", headers: auth(@alice)
    assert_response :success
    assert_equal old_pinned.id, response.parsed_body["posts"].first["id"]
  end

  test "an unpinned or expired-pin post does not lead the feed" do
    Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Expired pin",
      visibility: "public", pinned_until: 1.day.ago)
    newest = Post.create!(author_type: "user", author_id: @bob.id, created_by_user_id: @bob.id, body: "Newest", visibility: "public")

    get "/api/stage/feed", headers: auth(@alice)
    assert_response :success
    assert_equal newest.id, response.parsed_body["posts"].first["id"]
  end

  test "a system post renders with the Verse author and is not editable by anyone" do
    post = Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind: "welcome",
      body: "Welcome someone")

    get "/api/stage/posts/#{post.id}", headers: auth(@alice)
    assert_response :success
    author = response.parsed_body["post"]["author"]
    assert_equal "Verse", author["name"]
    assert author["system"]

    delete "/api/stage/posts/#{post.id}", headers: auth(@alice), as: :json
    assert_response :forbidden
  end

  test "a verified musician can post an event, and it appears in the upcoming events strip and as ICS" do
    @alice.profile.update!(verified: true)
    post "/api/stage/posts",
      params: { kind: "event", eventTitle: "Open Mic Night", eventStartsAt: 3.days.from_now.iso8601, eventVenue: "The Attic", city: "Mumbai" },
      headers: auth(@alice), as: :json
    assert_response :created
    event_id = response.parsed_body["id"]

    get "/api/stage/events?city=Mumbai", headers: auth(@bob)
    assert_response :success
    assert_equal [event_id], response.parsed_body["events"].map { _1["id"] }

    get "/api/stage/posts/#{event_id}/ics"
    assert_response :success
    assert_equal "text/calendar", response.media_type
    assert_includes response.body, "SUMMARY:Open Mic Night"
  end

  test "an unverified musician cannot post an event" do
    post "/api/stage/posts",
      params: { kind: "event", eventTitle: "Open Mic Night", eventStartsAt: 3.days.from_now.iso8601, eventVenue: "The Attic", city: "Mumbai" },
      headers: auth(@bob), as: :json
    assert_response :forbidden
    assert_equal "NOT_VERIFIED", response.parsed_body["code"]
  end

  private

  def with_real_cache
    original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    yield
  ensure
    Rails.cache = original_cache
  end

  def count_queries
    count = 0
    counter = lambda do |_name, _start, _finish, _id, payload|
      next if payload[:cached] || %w[SCHEMA TRANSACTION].include?(payload[:name])
      next if payload[:sql].match?(/\A\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i)
      count += 1
    end
    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { yield }
    count
  end

  def create_job(employer, status)
    Job.create!(employer:, title: "Stage job #{SecureRandom.hex(3)}", company: employer.name, location: "Mumbai", kind: "Contract",
      opportunity_kind: "gig", workplace: "onsite", genre: "Live", skills: ["Mixing"],
      description: "A clearly documented paid engagement with rehearsals, written terms and on-site production support.",
      status:, published_at: status == "published" ? Time.current : nil)
  end

  def create_user(name, role, profile = {})
    @seq += 1
    User.create!(name:, email: "stage-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true, email_verified: true).tap { _1.create_profile!(profile) }
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
