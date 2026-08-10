/**
 * Tiered vocabulary. Tier index comes from `DifficultyParams.vocabularyTier`
 * (§6.1): early tiers stay on the home row and in short, high-frequency words;
 * later tiers introduce full-keyboard reach, capitals, digits and punctuation.
 *
 * Word text is data, never markup — see §15. The renderer draws it to canvas
 * and the a11y layer sets it via textContent, so imported vocabulary can never
 * become HTML.
 */

const TIER_0_HOME_ROW = [
  'ad', 'as', 'ask', 'dad', 'fad', 'fall', 'flask', 'gas', 'glad', 'had',
  'half', 'hall', 'has', 'jag', 'lad', 'lag', 'lash', 'lass', 'sad', 'salad',
  'shall', 'slash', 'add', 'all', 'dash', 'flag', 'gall', 'gash', 'hash', 'jak',
  'lads', 'flags', 'halls', 'shad', 'slag', 'falls', 'glass', 'safe', 'fake', 'lake',
];

const TIER_1_COMMON_SHORT = [
  'the', 'and', 'for', 'you', 'are', 'but', 'not', 'was', 'all', 'can',
  'her', 'has', 'him', 'his', 'how', 'its', 'new', 'now', 'old', 'one',
  'our', 'out', 'day', 'get', 'use', 'man', 'way', 'who', 'boy', 'did',
  'see', 'two', 'sit', 'set', 'run', 'top', 'end', 'big', 'ask', 'own',
  'here', 'from', 'they', 'have', 'this', 'that', 'with', 'word', 'been', 'like',
  'time', 'work', 'life', 'over', 'find', 'take', 'made', 'city', 'even', 'good',
];

const TIER_2_MEDIUM = [
  'about', 'above', 'after', 'again', 'below', 'build', 'catch', 'chair', 'clean', 'clear',
  'close', 'cover', 'dance', 'drink', 'early', 'earth', 'field', 'first', 'floor', 'focus',
  'front', 'green', 'group', 'guide', 'happy', 'heart', 'house', 'human', 'label', 'large',
  'learn', 'light', 'local', 'money', 'month', 'music', 'never', 'north', 'ocean', 'order',
  'paper', 'party', 'place', 'plant', 'point', 'power', 'price', 'quick', 'quiet', 'reach',
  'right', 'river', 'round', 'sound', 'south', 'space', 'speak', 'stand', 'start', 'stone',
];

const TIER_3_LONG = [
  'absolute', 'advantage', 'algorithm', 'analysis', 'attention', 'available', 'boundary', 'calculate',
  'challenge', 'character', 'component', 'condition', 'confident', 'container', 'continue', 'creative',
  'decision', 'delivery', 'describe', 'developer', 'different', 'direction', 'discovery', 'education',
  'equipment', 'estimate', 'evaluate', 'excellent', 'exercise', 'expansion', 'experience', 'framework',
  'frequency', 'generate', 'important', 'increase', 'industry', 'influence', 'interface', 'knowledge',
  'landscape', 'language', 'magnitude', 'necessary', 'objective', 'operation', 'parameter', 'permanent',
  'potential', 'practice', 'principle', 'procedure', 'reference', 'sequence', 'structure', 'threshold',
];

const TIER_4_EXPERT = [
  'Abstraction', 'Asynchronous', 'Benchmarking', 'Cryptography', 'Determinism', 'Encapsulate',
  'Extrapolate', 'Idempotent', 'Instrumented', 'Interpolate', 'Orthogonal', 'Parallelism',
  'Polymorphic', 'Quantifiable', 'Refactoring', 'Serialization', 'Synchronize', 'Throughput',
  'Virtualized', 'array[0]', 'const x = 1;', 'i++;', 'null?.value', '(a, b) => a + b',
  '{ key: 42 }', 'x >= 0', 'a && b', 'foo|bar', '#hashtag', '"quoted"',
  'path/to/file', 'v1.2.3', '99.9%', 'user@host', 'O(n log n)', 'RFC-7231',
  'snake_case', 'kebab-case', 'camelCase', 'TODO:fix',
];

export const WORD_TIERS: readonly (readonly string[])[] = [
  TIER_0_HOME_ROW,
  TIER_1_COMMON_SHORT,
  TIER_2_MEDIUM,
  TIER_3_LONG,
  TIER_4_EXPERT,
];

/**
 * Words eligible for a tier: everything from that tier plus the tier below,
 * so vocabulary widens rather than swapping out wholesale on a level-up.
 */
export function candidatesForTier(tier: number): readonly string[] {
  const t = Math.max(0, Math.min(WORD_TIERS.length - 1, Math.floor(tier)));
  if (t === 0) return WORD_TIERS[0]!;
  return [...WORD_TIERS[t - 1]!, ...WORD_TIERS[t]!];
}
