import { FireIcon, BrainIcon, QuestionIcon, HeadphonesIcon, BookIcon, NetworkIcon, ChartIcon, SettingsIcon } from './LearnIcons';

const MAP = {
  fire: FireIcon,
  brain: BrainIcon,
  question: QuestionIcon,
  headphones: HeadphonesIcon,
  book: BookIcon,
  network: NetworkIcon,
  chart: ChartIcon,
  settings: SettingsIcon,
};

/** Render a named Learn icon. Color comes from `color` (or inherited currentColor). */
export function Icon({ name, size = 20, color, className }) {
  const C = MAP[name];
  if (!C) return null;
  return <C size={size} className={className} style={color ? { color } : undefined} />;
}
