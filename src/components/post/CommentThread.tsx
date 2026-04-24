import { PostCard } from '../feed/PostCard';

export function CommentThread({ post, replies }: { post: any, replies: any[] }) {
  // Simple flat view for thread context
  return (
    <div className="border-l border-brand-border ml-5 mt-2 bg-[rgba(255,255,255,0.01)] relative">
      {replies.map((reply: any, idx) => (
        <div key={reply.id} className="relative">
          {/* Connector line for thread */}
          {idx !== replies.length - 1 && (
            <div className="absolute left-[-1px] top-10 bottom-[-10px] w-px bg-brand-border -z-10" />
          )}
          <PostCard post={reply} />
        </div>
      ))}
    </div>
  );
}
