import { LoadMore } from './LoadMore';

type Props = {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => Promise<number | null>;
  onNear?: () => void;
};

const NOUN = ['opportunity', 'opportunities'] as const;

/** LoadMore for opportunity lists, whose items carry `data-job-item={index}`. */
export function LoadMoreJobs(props: Props) {
  return <LoadMore {...props} noun={NOUN} itemAttribute="data-job-item" />;
}
