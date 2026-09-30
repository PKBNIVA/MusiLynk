import { Link } from 'react-router';
import { Button } from '../ui/button';
import { Scene, type SceneName } from './scenes';

type Props = {
  scene: SceneName;
  title: string;
  action?: { label: string; to?: string; onClick?: () => void };
  hint?: string;
};

/** Illustration + one sentence + one button. Nothing else. */
export function EmptyState({ scene, title, action, hint }: Props) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center" data-testid="empty-state">
      <Scene name={scene} className="mx-auto" />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-400">{hint}</p>}
      {action &&
        (action.to ? (
          <Button asChild className="mt-5">
            <Link to={action.to}>{action.label}</Link>
          </Button>
        ) : (
          <Button className="mt-5" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  );
}
