/* how well you play: picked on the first start (and in Settings), it sets your starting rating and how strong opponents are
   by default. Pure data, no imports. GPL-3.0-or-later
   level: the built-in engine level (0-4, about 400 / 800 / 1200 / 1800 / 2200); elo: Stockfish and other engines with an Elo
   setting (never below 1350, Stockfish's lowest step); maia: the human-like Maia net; nodes: Leela's search; bot: who you face first. */
export const TIERS = [
  {id: 'new', name: 'New to chess', sub: 'I am learning how the pieces move', rating: 400, puzzle: 600, level: 0, elo: 1350, maia: '1100', nodes: 1, bot: 'builtin'},
  {id: 'beginner', name: 'Beginner', sub: 'I know the rules and play now and then', rating: 800, puzzle: 1000, level: 1, elo: 1350, maia: '1100', nodes: 1, bot: 'builtin'},
  {id: 'intermediate', name: 'Intermediate', sub: 'I know basic tactics and openings', rating: 1200, puzzle: 1400, level: 2, elo: 1350, maia: '1200', nodes: 1, bot: 'builtin'},
  {id: 'advanced', name: 'Advanced', sub: 'I play often, online or in a club', rating: 1600, puzzle: 1800, level: 3, elo: 1600, maia: '1600', nodes: 1, bot: 'stockfish'},
  {id: 'expert', name: 'Expert', sub: 'I play tournaments', rating: 2000, puzzle: 2200, level: 4, elo: 2000, maia: '1900', nodes: 10, bot: 'stockfish'},
];
export const tierById = id => TIERS.find(t => t.id === id) || null;
/* the level closest to a rating (players from before 1.3.1 never picked one) */
export const tierFor = r => TIERS.reduce((a, t) => Math.abs(t.rating - r) < Math.abs(a.rating - r) ? t : a);
