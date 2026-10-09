import { useParams } from 'react-router';
import { PostCard } from '../components/PostCard.tsx';
import { Empty, PageTitle, Spinner } from '../components/ui.tsx';
import { useApi } from '../lib/hooks.ts';

export function PostPage() {
  const { id } = useParams();
  const { data, loading, error } = useApi(`/posts/${id}`);
  return (
    <main className="page" style={{ maxWidth: 1020 }}>
      <PageTitle title="Post" back="/" />
      {loading ? <Spinner block /> : error ? <div className="card"><Empty icon="alert" title="Post not available">{error.message}</Empty></div> : <PostCard key={data.post.id} post={data.post} expandComments split />}
    </main>
  );
}
