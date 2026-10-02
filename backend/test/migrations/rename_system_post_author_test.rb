require "test_helper"
require Rails.root.join("db/migrate/20261002180000_rename_system_post_author_to_musilynk")

class RenameSystemPostAuthorTest < ActiveSupport::TestCase
  setup do
    @system_post = Post.create!(author_type: "system", author_id: "verse", kind: "system", system_kind: "welcome", system_ref: "welcome:rename-test", body: "Welcome")
    @user = User.create!(name: "Rename Tester", email: "rename-tester@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    @user_post = Post.create!(author_type: "user", author_id: @user.id, created_by_user_id: @user.id, kind: "update", body: "Hello")
    @comment = PostComment.create!(post: @user_post, author_type: "system", author_id: "verse", created_by_user_id: @user.id, body: "From the platform")
  end

  def migrate(direction)
    ActiveRecord::Migration.suppress_messages { RenameSystemPostAuthorToMusilynk.new.migrate(direction) }
  end

  test "up moves system authors to musilynk and leaves other authors alone, down reverses it" do
    migrate(:up)
    assert_equal "musilynk", @system_post.reload.author_id
    assert_equal "musilynk", @comment.reload.author_id
    assert_equal @user.id, @user_post.reload.author_id

    migrate(:down)
    assert_equal "verse", @system_post.reload.author_id
    assert_equal "verse", @comment.reload.author_id
    assert_equal @user.id, @user_post.reload.author_id
  end

  test "a user whose id happens to be verse is not touched" do
    odd = Post.create!(author_type: "organization", author_id: "verse", created_by_user_id: @user.id, kind: "update", body: "Org")
    migrate(:up)
    assert_equal "verse", odd.reload.author_id
  end
end
